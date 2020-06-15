import queue from './queue.js';
import VDom from './VDom.js';
import colorMap from './colorMap.js';
import geometry from './geometry.js';
import shaders from './shaders.js';
import earcut from 'earcut';
import Events from './events.js';
import behaviour from './behaviour.js';
import { CollectionPrototype, NodePrototype } from './coreApi.js';

let t2DGeometry = geometry;

let ratio;
const queueInstance = queue;

let zoomInstance = behaviour.zoom();
let dragInstance = behaviour.drag();

function getPixlRatio (ctx) {
	const dpr = window.devicePixelRatio || 1;
	const bsr = ctx.webkitBackingStorePixelRatio || ctx.mozBackingStorePixelRatio || ctx.msBackingStorePixelRatio || ctx.oBackingStorePixelRatio || ctx.backingStorePixelRatio || 1;
	return dpr / bsr;
}

let Id = 0;

function domId () {
	Id += 1;
	return Id;
}

function parseTransform (transform) {
	let output = {
		translateX: 0,
		translateY: 0,
		scaleX: 1,
		scaleY: 1
	};

	if (transform) {
		if (transform.translate && transform.translate.length > 0) {
			output.translateX = transform.translate[0];
			output.translateY = transform.translate[1];
		}

		if (transform.scale && transform.scale.length > 0) {
			output.scaleX = transform.scale[0];
			output.scaleY = transform.scale[1] || output.scaleX;
		}
	}

	return output;
}

function RPolyupdateBBox () {
	const self = this;
	const {
		transform,
		points = []
	} = self.attr;
	let {
		translateX,
		translateY,
		scaleX,
		scaleY
	} = parseTransform(transform);

	if (points && points.length > 0) {
		let minX = points[0].x;
		let maxX = points[0].x;
		let minY = points[0].y;
		let maxY = points[0].y;

		for (let i = 1; i < points.length; i += 1) {
			if (minX > points[i].x) minX = points[i].x;
			if (maxX < points[i].x) maxX = points[i].x;
			if (minY > points[i].y) minY = points[i].y;
			if (maxY < points[i].y) maxY = points[i].y;
		}

		self.BBox = {
			x: translateX + (minX * scaleX),
			y: translateY + (minY * scaleY),
			width: (maxX - minX) * scaleX,
			height: (maxY - minY) * scaleY
		};
	} else {
		self.BBox = {
			x: 0,
			y: 0,
			width: 0,
			height: 0
		};
	}

	if (transform && transform.rotate) {
		self.BBoxHit = t2DGeometry.rotateBBox(this.BBox, transform);
	} else {
		self.BBoxHit = this.BBox;
	}
}

let WebglCollection = function () {
	CollectionPrototype.apply(this, arguments);
};
WebglCollection.prototype = new CollectionPrototype();
WebglCollection.prototype.constructor = WebglCollection;
WebglCollection.prototype.createNode = function (ctx, config, vDomIndex) {
	return new WebglNodeExe(ctx, config, domId(), vDomIndex);
};

function loadShader (ctx, shaderSource, shaderType) {
	var shader = ctx.createShader(shaderType);
	ctx.shaderSource(shader, shaderSource);
	ctx.compileShader(shader);
	var compiled = ctx.getShaderParameter(shader, ctx.COMPILE_STATUS);

	if (!compiled) {
		var lastError = ctx.getShaderInfoLog(shader);
		console.error('*** Error compiling shader \'' + shader + '\':' + lastError);
		ctx.deleteShader(shader);
		return null;
	}

	return shader;
}

function createProgram (ctx, shaders) {
	var program = ctx.createProgram();
	shaders.forEach(function (shader) {
		ctx.attachShader(program, shader);
	});
	ctx.linkProgram(program);
	var linked = ctx.getProgramParameter(program, ctx.LINK_STATUS);

	if (!linked) {
		var lastError = ctx.getProgramInfoLog(program);
		console.error('Error in program linking:' + lastError);
		ctx.deleteProgram(program);
		return null;
	}

	return program;
}

function getProgram (ctx, shaderCode) {
	var shaders = [loadShader(ctx, shaderCode.vertexShader, ctx.VERTEX_SHADER), loadShader(ctx, shaderCode.fragmentShader, ctx.FRAGMENT_SHADER)];
	return createProgram(ctx, shaders);
}

function WebglDom () {
	this.BBox = {
		x: 0,
		y: 0,
		width: 0,
		height: 0
	};
	this.BBoxHit = {
		x: 0,
		y: 0,
		width: 0,
		height: 0
	};
}

WebglDom.prototype.setStyle = function (key, value) {
	if (value) {
		this.style[key] = value;
		if (this.shader && (key === 'fill')) {
			if (this.style.opacity !== undefined) {
				value.a *= this.style.opacity;
			}
			this.shader.updateColor(this.pindex, value);
		}
		if (this.shader && key === 'opacity') {
			if (this.style.fill !== undefined) {
				this.style.fill.a *= this.style.opacity;
			}
			this.shader.updateColor(this.pindex, this.style.fill); ;
		}
	} else if (this.style[key]) {
		delete this.style[key];
	}
};
WebglDom.prototype.getAttr = function (key) {
	return this.attr[key];
};

WebglDom.prototype.getStyle = function (key) {
	return this.style[key];
};

function PointNode (attr, style) {
	this.attr = attr || {};
	this.style = style || {};
};

PointNode.prototype = new WebglDom();
PointNode.prototype.constructor = PointNode;

PointNode.prototype.setShader = function (shader) {
	this.shader = shader;
	if (this.shader) {
		this.shader.addVertex(this.attr.x || 0, this.attr.y || 0, this.pindex);
		this.shader.addColors(this.style.fill || defaultColor, this.pindex);
		this.shader.addSize(this.attr.size || 0, this.pindex);
	}
};

PointNode.prototype.setAttr = function (prop, value) {
	this.attr[prop] = value;
	if (this.shader && (prop === 'x' || prop === 'y')) {
		this.shader.updateVertex(this.pindex, this.attr.x, this.attr.y);
	}

	if (this.shader && prop === 'size') {
		this.shader.updateSize(this.pindex, this.attr.size || 0);
	}
};

PointNode.prototype.updateBBox = function RRupdateBBox () {
	const self = this;
	const {
		transform,
		x = 0,
		y = 0,
		size = 0
	} = self.attr;
	let {
		translateX,
		translateY,
		scaleX,
		scaleY
	} = parseTransform(transform);

	self.BBox = {
		x: translateX + (x * scaleX),
		y: translateY + (y * scaleY),
		width: size * scaleX,
		height: size * scaleY
	};

	if (transform && transform.rotate) {
		self.BBoxHit = t2DGeometry.rotateBBox(this.BBox, transform);
	} else {
		self.BBoxHit = this.BBox;
	}
};

// PointNode.prototype.setStyle = function (key, value) {
// 	this.style[key] = value;
// 	if (this.shader && key === 'fill') {
// 		this.shader.updateColor(this.pindex, value);
// 	}
// };
// PointNode.prototype.getAttr = function (key) {
// 	return this.attr[key];
// };
// PointNode.prototype.getStyle = function (key) {
// 	return this.style[key];
// };


function RectNode (attr, style) {
	this.attr = attr || {};
	this.style = style || {};
}
RectNode.prototype = new WebglDom();
RectNode.prototype.constructor = RectNode;
RectNode.prototype.setShader = function (shader) {
	this.shader = shader;
	if (this.shader) {
		this.shader.addVertex(this.attr.x || 0, this.attr.y || 0, this.attr.width || 0, this.attr.height || 0, this.pindex);
		this.shader.addColors(this.style.fill || defaultColor, this.pindex);
	}
};

RectNode.prototype.setAttr = function (key, value) {
	this.attr[key] = value;
	if (!this.shader) {
		return;
	}
	if ((key === 'x' || key === 'width')) {
		this.shader.updateVertexX(this.pindex, this.attr.x || 0, this.attr.width || 0);
	}
	if ((key === 'y' || key === 'height')) {
		this.shader.updateVertexY(this.pindex, this.attr.y || 0, this.attr.height || 0);
	}
};
// RectNode.prototype.getAttr = function (key) {
// 	return this.attr[key];
// };

// RectNode.prototype.setStyle = function (key, value) {
// 	this.style[key] = value;
// 	if (this.shader && key === 'fill') {
// 		this.shader.updateColor(this.pindex, value);
// 	}
// };

// RectNode.prototype.getStyle = function (key) {
// 	return this.style[key];
// };

RectNode.prototype.in = function RRinfun (co) {
	const {
		x = 0,
		y = 0,
		width = 0,
		height = 0
	} = this.attr;
	return co.x >= x && co.x <= x + width && co.y >= y && co.y <= y + height;
};

RectNode.prototype.updateBBox = function RRupdateBBox () {
	const self = this;
	const {
		transform,
		x = 0,
		y = 0,
		width = 0,
		height = 0
	} = self.attr;
	let {
		translateX,
		translateY,
		scaleX,
		scaleY
	} = parseTransform(transform);

	self.BBox = {
		x: translateX + (x * scaleX),
		y: translateY + (y * scaleY),
		width: width * scaleX,
		height: height * scaleY
	};

	if (transform && transform.rotate) {
		self.BBoxHit = t2DGeometry.rotateBBox(this.BBox, transform);
	} else {
		self.BBoxHit = this.BBox;
	}
};

function PolyLineNode (attr, style) {
	this.attr = attr || {};
	this.style = style || {};
}
PolyLineNode.prototype = new WebglDom();
PolyLineNode.prototype.constructor = PolyLineNode;

PolyLineNode.prototype.setShader = function (shader) {
	this.shader = shader;
	if (this.shader) {
		this.shader.addVertex(this.attr.points || [], this.pindex);
		this.shader.addColors(this.style.stroke || defaultColor, this.pindex);
	}
};

PolyLineNode.prototype.setAttr = function (key, value) {
	this.attr[key] = value;
	if (this.shader && key === 'points') {
		this.shader.updateVertex(this.pindex, this.attr.points);
	}
};

PolyLineNode.prototype.updateBBox = RPolyupdateBBox;

// PolyLineNode.prototype.getAttr = function (key) {
// 	return this.attr[key];
// };

// PolyLineNode.prototype.setStyle = function (key, value) {
// 	this.style[key] = value;
// 	if (this.shader && key === 'stroke') {
// 		this.shader.updateColor(this.pindex, value);
// 	}
// };

// PolyLineNode.prototype.getStyle = function (key) {
// 	return this.style[key];
// };

function LineNode (attr, style) {
	this.attr = attr || {};
	this.style = style || {};
}

LineNode.prototype = new WebglDom();
LineNode.prototype.constructor = LineNode;

LineNode.prototype.setShader = function (shader) {
	this.shader = shader;
	let {
		x1 = 0,
		y1 = 0,
		x2 = x1,
		y2 = y1
	} = this.attr;

	if (this.shader) {
		this.shader.addVertex(x1, y1, x2, y2, this.pindex);
		this.shader.addColors(this.style.stroke || defaultColor, this.pindex);
	}
};

LineNode.prototype.setAttr = function (key, value) {
	this.attr[key] = value;
	if (value === undefined || value === null) {
		delete this.attr[key];
		return;
	}
	if (this.shader && (key === 'x1' || key === 'y1' || key === 'x2' || key === 'y2')) {
		this.shader.updateVertex(this.pindex, this.attr.x1, this.attr.y1, this.attr.x2, this.attr.y2);
	}
};

LineNode.prototype.updateBBox = function RLupdateBBox () {
	const self = this;
	const {
		transform,
		x1 = 0,
		y1 = 0,
		x2 = 0,
		y2 = 0
	} = self.attr;
	let {
		translateX,
		translateY,
		scaleX,
		scaleY
	} = parseTransform(transform);

	self.BBox = {
		x: translateX + ((x1 < x2 ? x1 : x2) * scaleX),
		y: translateY + ((y1 < y2 ? y1 : y2) * scaleY),
		width: Math.abs(x2 - x1) * scaleX,
		height: Math.abs(y2 - y1) * scaleY
	};

	if (transform && transform.rotate) {
		self.BBoxHit = t2DGeometry.rotateBBox(this.BBox, transform);
	} else {
		self.BBoxHit = this.BBox;
	}
};

// LineNode.prototype.getAttr = function (key) {
// 	return this.attr[key];
// };

// LineNode.prototype.setStyle = function (key, value) {
// 	this.style[key] = value;
// 	if (this.shader && key === 'stroke') {
// 		this.shader.updateColor(this.pindex, value);
// 	}
// };

// LineNode.prototype.getStyle = function (key) {
// 	return this.style[key];
// };

function polygonPointsMapper (value) {
	return earcut(value.reduce(function (p, c) {
		p[p.length] = c.x;
		p[p.length] = c.y;
		return p;
	}, [])).map(function (d) {
		return value[d];
	});
}

function PolygonNode (attr, style) {
	this.attr = attr;
	this.style = style;
	this.positionArray = [];

	if (this.attr['points']) {
		this.triangulatedPoints = polygonPointsMapper(this.attr['points']);
	}
}

PolygonNode.prototype = new WebglDom();
PolygonNode.prototype.constructor = PolygonNode;

PolygonNode.prototype.setShader = function (shader) {
	this.shader = shader;
	if (this.shader) {
		this.shader.addVertex(this.triangulatedPoints || [], this.pindex);
		this.shader.addColors(this.style.fill || defaultColor, this.pindex);
	}
};

// PolygonNode.prototype.setStyle = function (key, value) {
// 	this.style[key] = value;
// 	if (this.shader && key === 'fill') {
// 		this.shader.updateColors(value || defaultColor);
// 	}
// };

PolygonNode.prototype.setAttr = function (key, value) {
	this.attr[key] = value;
	if (value === undefined || value === null) {
		delete this.attr[key];
		return;
	}
	if (key === 'points') {
		this.triangulatedPoints = polygonPointsMapper(value);
		if (this.shader) {
			this.shader.updateVertex(this.triangulatedPoints || [], this.pindex);
		}
	}
};

// PolygonNode.prototype.getAttr = function (key) {
// 	return this.attr[key];
// };

// PolygonNode.prototype.getStyle = function (key) {
// 	return this.style[key];
// };

PolygonNode.prototype.updateBBox = RPolyupdateBBox;

function CircleNode (attr, style) {
	this.attr = attr;
	this.style = style;
}

CircleNode.prototype = new WebglDom();
CircleNode.prototype.constructor = CircleNode;

CircleNode.prototype.setShader = function (shader) {
	this.shader = shader;
	if (this.shader) {
		this.shader.addVertex(this.attr.cx || 0, this.attr.cy || 0, this.pindex);
		this.shader.addColors(this.style.fill || defaultColor, this.pindex);
		this.shader.addSize(this.attr.r || 0, this.pindex);
	}
};

CircleNode.prototype.setAttr = function (prop, value) {
	this.attr[prop] = value;
	if (value === undefined || value === null) {
		delete this.attr[prop];
		return;
	}
	if (this.shader && (prop === 'cx' || prop === 'cy')) {
		this.shader.updateVertex(this.pindex, this.attr.cx, this.attr.cy);
	}

	if (this.shader && prop === 'r') {
		this.shader.updateSize(this.pindex, this.attr.r || 0);
	}
};
// CircleNode.prototype.setStyle = function (key, value) {
// 	this.style[key] = value;
// 	if (this.shader && key === 'fill') {
// 		this.shader.updateColor(this.pindex, value);
// 	}
// };

// CircleNode.prototype.getAttr = function (key) {
// 	return this.attr[key];
// };

// CircleNode.prototype.getStyle = function (key) {
// 	return this.style[key];
// };

CircleNode.prototype.in = function RCinfun (co, eventType) {
	const {
		r = 0,
		cx = 0,
		cy = 0
	} = this.attr;
	let tr = Math.sqrt(((co.x - cx) * (co.x - cx)) + ((co.y - cy) * (co.y - cy)));
	return tr <= r;
};

CircleNode.prototype.updateBBox = function RCupdateBBox () {
	const self = this;
	const {
		transform,
		r = 0,
		cx = 0,
		cy = 0
	} = self.attr;
	let {
		translateX,
		translateY,
		scaleX,
		scaleY
	} = parseTransform(transform);

	self.BBox = {
		x: translateX + ((cx - r) * scaleX),
		y: translateY + ((cy - r) * scaleY),
		width: 2 * r * scaleX,
		height: 2 * r * scaleY
	};

	if (transform && transform.rotate) {
		self.BBoxHit = t2DGeometry.rotateBBox(this.BBox, transform);
	} else {
		self.BBoxHit = this.BBox;
	}
};

let webGLImageTextures = {};

function isPowerOf2 (value) {
	return (value & value - 1) === 0;
}

let onClear = function (ctx, width, height, ratio) {
	ctx.clearRect(0, 0, width * ratio, height * ratio);
};

function buildCanvasTextEl (str, style) {
	const layer = document.createElement('canvas');
	const ctx = layer.getContext('2d', {});
	// let ratio = getPixlRatio(ctx);
	style = style || {
		fill: '#fff'
	};

	let fontSize = parseFloat(style.font, 10) || 12;
	let twid = ctx.measureText(str).width;
	let width = twid * fontSize * 0.1;
	let height = fontSize;
	layer.setAttribute('height', height * ratio);
	layer.setAttribute('width', width * ratio);
	layer.style.height = height + 'px';
	layer.style.width = width + 'px';

	for (let st in style) {
		ctx[st] = style[st];
	}
	ctx.fillText(str, 0, height * 0.75);

	return {
		dom: layer,
		ctx: ctx,
		width: width,
		height: height,
		ratio: ratio,
		style: style,
		str: str,
		updateText: function () {
			onClear(this.ctx, this.width, this.height, this.ratio);
			for (let st in this.style) {
				this.ctx[st] = this.style[st];
			}
			this.ctx.fillText(this.str, 0, (this.height * 0.75));
		}
	};
}

function TextNode (ctx, attr, style, vDomIndex) {
	let self = this;
	this.ctx = ctx;
	this.attr = attr;
	this.style = style;
	this.vDomIndex = vDomIndex;
	
	if (self.attr.text && (typeof self.attr.text === 'string')) {
		this.text = buildCanvasTextEl(self.attr.text, self.style);
		this.attr.width = this.text.width;
		this.attr.height = this.text.height;
	}

	if (this.text) {
		this.textureNode = new TextureObject(ctx, {
			src: this.text.dom
		}, this.vDomIndex);
	}
}
TextNode.prototype = new WebglDom();
TextNode.prototype.constructor = TextNode;

TextNode.prototype.setShader = function (shader) {
	this.shader = shader;
	if (this.shader) {
		this.shader.addVertex(this.attr.x || 0, this.attr.y || 0, this.attr.width || 0, this.attr.height || 0, this.pindex);
		// this.shader.addOpacity(1, this.pindex);
	}
};

TextNode.prototype.setAttr = function (key, value) {
	this.attr[key] = value;

	if (value === undefined || value === null) {
		delete this.attr[key];
		return;
	}

	if (key === 'text' && (typeof value === 'string')) {
		if (this.text) {
			this.text = buildCanvasTextEl(this.attr.text, this.style);
			// this.attr.width = this.text.width;
			// this.attr.height = this.text.height;
		} else {
			this.text = buildCanvasTextEl(value, this.style);
		}
		this.attr.width = this.text.width;
		this.attr.height = this.text.height;
		// this.shader.updateVertexX(this.pindex, this.attr.x || 0, this.attr.width || 0);
		// this.shader.updateVertexY(this.pindex, this.attr.y || 0, this.attr.height || 0);
		if (this.textureNode) {
			this.textureNode.setAttr('src', this.text.dom);
		} else {
			this.textureNode = new TextureObject(this.ctx, {
				src: this.text.dom
			}, this.vDomIndex);
		}
	}
	
	if (this.shader && (key === 'x')) {
		this.shader.updateVertexX(this.pindex, this.attr.x || 0, this.attr.width || 0);
	}
	if (this.shader && (key === 'y')) {
		this.shader.updateVertexY(this.pindex, this.attr.y || 0, this.attr.height || 0);
	}
};

TextNode.prototype.setStyle = function (key, value) {
	this.style[key] = value;
	if (this.text) {
		if (key === 'font') {
			let fontSize = parseFloat(value, 10) || 12;
			let twid = this.text.ctx.measureText(this.attr.text).width;
			let width = twid * fontSize * 0.1;
			let height = fontSize;
			this.attr.width = width;
			this.attr.height = height;
			this.shader.updateVertexX(this.pindex, this.attr.x || 0, this.attr.width || 0);
			this.shader.updateVertexY(this.pindex, this.attr.y || 0, this.attr.height || 0);
		} else {
			this.text.style[key] = value;
			// this.text.execute();
			this.text.updateText();
			this.textureNode.setAttr('src', this.text.dom);
		}
	}
};

TextNode.prototype.getAttr = function (key) {
	return this.attr[key];
};

TextNode.prototype.getStyle = function (key) {
	return this.style[key];
};

// TextNode.prototype.in = function RIinfun (co) {
// 	const {
// 		width = 0,
// 		height = 0,
// 		x = 0,
// 		y = 0
// 	} = this.attr;
// 	return co.x >= x && co.x <= x + width && co.y >= y && co.y <= y + height;
// };

// function buildCanvasTextEl (str, style) {
// 	let text = canvas.canvasLayer(null, {}, {});
// 	text.setPixelRatio(ratio);
// 	let fontSize = parseInt(style.font, 10) || 12;
// 	let twid = text.ctx.measureText(str).width;
// 	let width = twid * fontSize * 0.1;
// 	let height = fontSize;
// 	text.setSize(width, height);

// 	text.createEl({
// 		el: 'text',
// 		attr: {
// 			x: 0,
// 			y: (height * 0.75),
// 			text: str
// 		},
// 		style: style
// 	});
// 	text.execute();

// 	return text;
// }

// function TextNode (ctx, attr, style, vDomIndex) {
// 	let self = this;
// 	this.ctx = ctx;
// 	this.attr = attr;
// 	this.style = style;
// 	this.vDomIndex = vDomIndex;
	
// 	if (self.attr.text && (typeof self.attr.text === 'string')) {
// 		this.text = buildCanvasTextEl(self.attr.text, self.style);
// 		this.attr.width = this.text.width * 1;
// 		this.attr.height = this.text.height;
// 	}

// 	if (this.text) {
// 		this.textureNode = new TextureObject(ctx, {
// 			src: this.text
// 		}, this.vDomIndex);
// 	}
// }
// TextNode.prototype = new WebglDom();
// TextNode.prototype.constructor = TextNode;

// TextNode.prototype.setShader = function (shader) {
// 	this.shader = shader;
// 	if (this.shader) {
// 		this.shader.addVertex(this.attr.x || 0, this.attr.y || 0, this.attr.width || 0, this.attr.height || 0, this.pindex);
// 		// this.shader.addOpacity(1, this.pindex);
// 	}
// };

// TextNode.prototype.setAttr = function (key, value) {
// 	this.attr[key] = value;

// 	if (value === undefined || value === null) {
// 		delete this.attr[key];
// 		return;
// 	}

// 	if (key === 'text' && (typeof value === 'string')) {
// 		if (this.text) {
// 			this.text = buildCanvasTextEl(this.attr.text, this.style);
// 			// this.attr.width = this.text.width;
// 			// this.attr.height = this.text.height;
// 		} else {
// 			this.text = buildCanvasTextEl(value, this.style);
// 		}
// 		this.attr.width = this.text.width * 1;
// 		this.attr.height = this.text.height;
// 		// this.shader.updateVertexX(this.pindex, this.attr.x || 0, this.attr.width || 0);
// 		// this.shader.updateVertexY(this.pindex, this.attr.y || 0, this.attr.height || 0);
// 		if (this.textureNode) {
// 			this.textureNode.setAttr('src', this.text);
// 		} else {
// 			this.textureNode = new TextureObject(this.ctx, {
// 				src: this.text
// 			}, this.vDomIndex);
// 		}
// 	}
	
// 	if (this.shader && (key === 'x')) {
// 		this.shader.updateVertexX(this.pindex, this.attr.x || 0, this.attr.width || 0);
// 	}
// 	if (this.shader && (key === 'y')) {
// 		this.shader.updateVertexY(this.pindex, this.attr.y || 0, this.attr.height || 0);
// 	}
// };

// TextNode.prototype.setStyle = function (key, value) {
// 	this.style[key] = value;
// 	if (this.text) {
// 		if (key === 'font') {
// 			let fontSize = parseInt(value, 10) || 12;
// 			let twid = this.text.ctx.measureText(this.attr.text).width;
// 			let width = twid * fontSize * 0.07;
// 			let height = fontSize * 0.5;
// 			this.attr.width = width;
// 			this.attr.height = height;
// 			this.shader.updateVertexX(this.pindex, this.attr.x || 0, this.attr.width || 0);
// 			this.shader.updateVertexY(this.pindex, this.attr.y || 0, this.attr.height || 0);
// 		} else {
// 			this.text.fetchEl('text').setStyle(key, value);
// 			this.text.execute();
// 			this.textureNode.setAttr('src', this.text);
// 		}
// 	}
// };

// TextNode.prototype.getAttr = function (key) {
// 	return this.attr[key];
// };

// TextNode.prototype.getStyle = function (key) {
// 	return this.style[key];
// };

TextNode.prototype.in = function RIinfun (co) {
	const {
		width = 0,
		height = 0,
		x = 0,
		y = 0
	} = this.attr;
	return co.x >= x && co.x <= x + width && co.y >= y && co.y <= y + height;
};

TextNode.prototype.updateBBox = function RIupdateBBox () {
	const self = this;
	const {
		transform,
		x = 0,
		y = 0,
		width = 0,
		height = 0
	} = self.attr;
	let {
		translateX,
		translateY,
		scaleX,
		scaleY
	} = parseTransform(transform);

	self.BBox = {
		x: (translateX + x) * scaleX,
		y: (translateY + y) * scaleY,
		width: width * scaleX,
		height: height * scaleY
	};

	if (transform && transform.rotate) {
		self.BBoxHit = t2DGeometry.rotateBBox(this.BBox, transform);
	} else {
		self.BBoxHit = this.BBox;
	}
};

function ImageNode (ctx, attr, style, vDomIndex) {
	let self = this;
	this.ctx = ctx;
	this.attr = attr;
	this.style = style;
	this.vDomIndex = vDomIndex;
	
	if (self.attr.src && typeof self.attr.src === 'string' && !webGLImageTextures[self.attr.src]) {
		this.textureNode = new TextureObject(ctx, {
			src: this.attr.src
		}, this.vDomIndex);
		webGLImageTextures[self.attr.src] = this.textureNode;
	} else if (typeof self.attr.src === 'string' && webGLImageTextures[self.attr.src]) {
		this.textureNode = webGLImageTextures[self.attr.src];
	} else if (self.attr.src && self.attr.src instanceof TextureObject) {
		this.textureNode = self.attr.src;
	}
};

ImageNode.prototype = new WebglDom();
ImageNode.prototype.constructor = ImageNode;

ImageNode.prototype.setShader = function (shader) {
	this.shader = shader;
	if (this.shader) {
		this.shader.addVertex(this.attr.x || 0, this.attr.y || 0, this.attr.width || 0, this.attr.height || 0, this.pindex);
		// this.shader.addOpacity(1, this.pindex);
	}
};

ImageNode.prototype.setAttr = function (key, value) {
	this.attr[key] = value;

	if (value === undefined || value === null) {
		delete this.attr[key];
		return;
	}

	if (key === 'src' && (typeof value === 'string')) {
		if (value && !webGLImageTextures[value]) {
			this.textureNode = new TextureObject(this.ctx, {
				src: value
			}, this.vDomIndex);
			 webGLImageTextures[value] = this.textureNode;
		}
	} else if (key === 'src' && value instanceof NodePrototype) {
		this.textureNode = new TextureObject(this.ctx, {
			src: value
		}, this.vDomIndex);
	} else if (key === 'src' && value instanceof TextureObject) {
		this.textureNode = value;
	}
	if (!this.shader) {
		return;
	}
	if ((key === 'x' || key === 'width')) {
		this.shader.updateVertexX(this.pindex, this.attr.x || 0, this.attr.width || 0);
	}
	if ((key === 'y' || key === 'height')) {
		this.shader.updateVertexY(this.pindex, this.attr.y || 0, this.attr.height || 0);
	}
};

ImageNode.prototype.setStyle = function (key, value) {
	if (value) {
		this.style[key] = value;
	} else if (this.style[key]) {
		delete this.style[key];
	}
	// if (this.shader && key === 'opacity') {
	// 	this.shader.updateOpacity(this.pindex, value);
	// }
};

ImageNode.prototype.getAttr = function (key) {
	return this.attr[key];
};

ImageNode.prototype.getStyle = function (key) {
	return this.style[key];
};

ImageNode.prototype.in = function RIinfun (co) {
	const {
		width = 0,
		height = 0,
		x = 0,
		y = 0
	} = this.attr;
	return co.x >= x && co.x <= x + width && co.y >= y && co.y <= y + height;
};

ImageNode.prototype.updateBBox = function RIupdateBBox () {
	const self = this;
	const {
		transform,
		x = 0,
		y = 0,
		width = 0,
		height = 0
	} = self.attr;
	let {
		translateX,
		translateY,
		scaleX,
		scaleY
	} = parseTransform(transform);

	self.BBox = {
		x: (translateX + x) * scaleX,
		y: (translateY + y) * scaleY,
		width: width * scaleX,
		height: height * scaleY
	};

	if (transform && transform.rotate) {
		self.BBoxHit = t2DGeometry.rotateBBox(this.BBox, transform);
	} else {
		self.BBoxHit = this.BBox;
	}
};


function WebglGroupNode (ctx, attr, style, renderTarget, vDomIndex) {
	// let self = this;
	this.ctx = ctx;
	this.attr = attr;
	this.style = style;
	this.renderTarget = renderTarget;
	this.vDomIndex = vDomIndex;
	if (attr.shaderType) {
		this.shader = getTypeShader(ctx, attr, style, attr.shaderType, this.renderTarget, vDomIndex);
	}
	if (this.shader && this.attr.transform) {
		if (this.attr.transform['translate']) {
			this.shader.translate(this.attr.transform['translate']);
		}
		if (this.attr.transform['scale']) {
			this.shader.scale(this.attr.transform['scale']);
		}
		if (this.attr.transform['rotate']) {
			this.shader.rotate(this.attr.transform['rotate']);
		}
	}
}

WebglGroupNode.prototype = new WebglDom();
WebglGroupNode.prototype.constructor = WebglGroupNode;

WebglGroupNode.prototype.setAttr = function (key, value) {
	this.attr[key] = value;
	if (key === 'shaderType') {
		this.shader = getTypeShader(this.ctx, this.attr, this.style, value, this.renderTarget, this.vDomIndex);
	}
	if (key === 'transform' && this.shader) {
		if (this.attr.transform['translate']) {
			this.shader.translate(this.attr.transform['translate']);
		}
		if (this.attr.transform['scale']) {
			this.shader.scale(this.attr.transform['scale']);
		}
		if (this.attr.transform['rotate']) {
			this.shader.rotate(this.attr.transform['rotate']);
		}
	}
};

WebglGroupNode.prototype.setShader = function () {

};

// WebglGroupNode.prototype.getAttr = function (key) {
// 	return this.attr[key];
// };

// WebglGroupNode.prototype.getStyle = function (key) {
// 	return this.style[key];
// };

WebglGroupNode.prototype.in = function RGinfun (coOr) {
	const self = this;
	const co = {
		x: coOr.x,
		y: coOr.y
	};
	const {
		BBox
	} = this;
	const {
		transform
	} = self.attr;
	let {
		translateX,
		translateY,
		scaleX,
		scaleY
	} = parseTransform(transform);

	return co.x >= (BBox.x - translateX) / scaleX && co.x <= (BBox.x - translateX + BBox.width) / scaleX && co.y >= (BBox.y - translateY) / scaleY && co.y <= (BBox.y - translateY + BBox.height) / scaleY;
};

WebglGroupNode.prototype.updateBBox = function RGupdateBBox (children) {
	const self = this;
	let minX;
	let maxX;
	let minY;
	let maxY;
	const {
		transform
	} = self.attr;
	let {
		translateX,
		translateY,
		scaleX,
		scaleY
	} = parseTransform(transform);
	self.BBox = {};

	if (children && children.length > 0) {
		let d;
		let boxX;
		let boxY;

		for (let i = 0; i < children.length; i += 1) {
			d = children[i];
			if (!d) {
				continue;
			}
			boxX = d.dom.BBoxHit.x;
			boxY = d.dom.BBoxHit.y;
			minX = minX === undefined ? boxX : minX > boxX ? boxX : minX;
			minY = minY === undefined ? boxY : minY > boxY ? boxY : minY;
			maxX = maxX === undefined ? boxX + d.dom.BBoxHit.width : maxX < boxX + d.dom.BBoxHit.width ? boxX + d.dom.BBoxHit.width : maxX;
			maxY = maxY === undefined ? boxY + d.dom.BBoxHit.height : maxY < boxY + d.dom.BBoxHit.height ? boxY + d.dom.BBoxHit.height : maxY;
		}
	}

	minX = minX === undefined ? 0 : minX;
	minY = minY === undefined ? 0 : minY;
	maxX = maxX === undefined ? 0 : maxX;
	maxY = maxY === undefined ? 0 : maxY;
	self.BBox.x = translateX + (minX * scaleX);
	self.BBox.y = translateY + (minY * scaleY);
	self.BBox.width = Math.abs(maxX - minX) * scaleX;
	self.BBox.height = Math.abs(maxY - minY) * scaleY;

	if (self.attr.transform && self.attr.transform.rotate) {
		self.BBoxHit = t2DGeometry.rotateBBox(this.BBox, this.attr.transform);
	} else {
		self.BBoxHit = this.BBox;
	}
};

let defaultColor = colorMap.rgba(0, 0, 0, 255);

function webGlAttrMapper (ctx, program, attr, attrObj) {
	let valType = attrObj.type;
	if (!valType) {
		valType = 'FLOAT';
		if (attrObj.value instanceof Float32Array) {
			valType = 'FLOAT';
		} else if (attrObj.value instanceof Int8Array) {
			valType = 'BYTE';
		} else if (attrObj.value instanceof Int16Array) {
			valType = 'SHORT';
		} else if (attrObj.value instanceof Uint8Array) {
			valType = 'UNSIGNED_BYTE';
		} else if (attrObj.value instanceof Uint16Array) {
			valType = 'UNSIGNED_SHORT';
		}
	}
	
	return {
		bufferType: ctx['ARRAY_BUFFER'],
		buffer: ctx.createBuffer(),
		drawType: ctx['STATIC_DRAW'],
		valueType: ctx[valType],
		size: attrObj.size,
		attributeLocation: ctx.getAttribLocation(program, attr),
		value: attrObj.value,
		attr: attr
	};
}

function webGlIndexMapper (ctx, program, attrObj) {
	let valType = 'FLOAT';
	if (attrObj.value instanceof Float32Array) {
		valType = 'FLOAT';
	} else if (attrObj.value instanceof Int8Array) {
		valType = 'BYTE';
	} else if (attrObj.value instanceof Int16Array) {
		valType = 'SHORT';
	} else if (attrObj.value instanceof Uint8Array) {
		valType = 'UNSIGNED_BYTE';
	} else if (attrObj.value instanceof Uint16Array) {
		valType = 'UNSIGNED_SHORT';
	}
	
	return {
		bufferType: ctx['ELEMENT_ARRAY_BUFFER'],
		buffer: ctx.createBuffer(),
		drawType: ctx['STATIC_DRAW'],
		valueType: ctx[valType],
		value: attrObj.value,
		count: attrObj.count,
		offset: attrObj.offset
	};
}

function webGlUniformMapper (ctx, program, uniform, uniObj) {
	let type;
	let len = uniObj.size ? uniObj.size : uniObj.value.length;
	if (!uniObj.matrix) {
		if (uniObj.value instanceof TextureObject) {
			type = 'uniform1i';
		} else if (uniObj.value instanceof Float32Array) {
			type = 'uniform' + len + 'fv';
		} else if (uniObj.value instanceof Int8Array || uniObj.value instanceof Int16Array || uniObj.value instanceof Uint8Array) {
			type = 'uniform' + len + 'iv';
		} else if (!Number.isInteger(uniObj.value)) {
			type = 'uniform1f';
		} else if (Number.isInteger(uniObj.value)) {
			type = 'uniform1i';
		}
	} else {
		if (!Number.isInteger(Math.sqrt(uniObj.value.length))) {
			type = 'uniformMatrix' + Math.sqrt(uniObj.value.length) + 'fv';
		} else {
			console.error('Not Square Matrix');
		}
	}
	
	return {
		matrix: uniObj.matrix,
		transpose: uniObj.transpose,
		type: type,
		value: uniObj.value,
		uniformLocation: ctx.getUniformLocation(program, uniform)
	};
}

function RenderWebglShader (ctx, shader, vDomIndex) {
	this.ctx = ctx;
	this.dom = {
		BBoxHit: {
			x: 0, y: 0, height: 0, width: 0
		}
	};
	this.shader = shader;
	this.vDomIndex = vDomIndex;
	this.program = getProgram(ctx, shader);
	this.uniforms = {};
	this.attr = {};
	this.attrObjs = {};
	this.indexesObj = null;
	this.preDraw = shader.preDraw;
	this.postDraw = shader.postDraw;
	this.geometry = shader.geometry;
	this.renderTarget = shader.renderTarget;

	for (let uniform in shader.uniforms) {
		this.uniforms[uniform] = webGlUniformMapper(ctx, this.program, uniform, shader.uniforms[uniform]);
	}

	if (this.geometry) {
		if (this.geometry instanceof MeshGeometry || this.geometry instanceof PointsGeometry || this.geometry instanceof LineGeometry) {
			this.attributes = this.geometry.attributes;
			this.indexes = this.geometry.indexes;
		} else {
			console.error('Wrong Geometry type');
		}
	}

	for (let attr in this.attributes) {
		this.attrObjs[attr] = webGlAttrMapper(ctx, this.program, attr, this.attributes[attr]);
	}

	if (this.indexes) {
		this.indexesObj = webGlIndexMapper(ctx, this.program, this.indexes);
	}
}

RenderWebglShader.prototype = new ShaderNodePrototype();
RenderWebglShader.prototype.constructor = RenderWebglShader;

RenderWebglShader.prototype.useProgram = function () {
	this.ctx.useProgram(this.program);
};

RenderWebglShader.prototype.applyUniforms = function () {
	for (let uniform in this.uniforms) {
		if (this.uniforms[uniform].matrix) {
			this.ctx[this.uniforms[uniform].type](this.uniforms[uniform].uniformLocation, this.uniforms[uniform].transpose, this.uniforms[uniform].value);
		} else {
			if (this.uniforms[uniform].value instanceof TextureObject) {
				this.ctx[this.uniforms[uniform].type](this.uniforms[uniform].uniformLocation, this.uniforms[uniform].value.texture);
				this.uniforms[uniform].value.loadTexture();
			} else {
				this.ctx[this.uniforms[uniform].type](this.uniforms[uniform].uniformLocation, this.uniforms[uniform].value);
			}
		}
	}
};

RenderWebglShader.prototype.applyAttributes = function () {
	let d;
	for (let attr in this.attrObjs) {
		d = this.attrObjs[attr];
		this.ctx.bindBuffer(d.bufferType, d.buffer);
		this.ctx.bufferData(d.bufferType, this.attributes[d.attr].value, d.drawType);
		this.ctx.enableVertexAttribArray(d.attributeLocation);
		this.ctx.vertexAttribPointer(d.attributeLocation, d.size, d.valueType, true, 0, 0);
	}
};

RenderWebglShader.prototype.applyIndexes = function () {
	let d = this.indexesObj;
	this.ctx.bindBuffer(d.bufferType, d.buffer);
	this.ctx.bufferData(d.bufferType, d.value, d.drawType);
};

RenderWebglShader.prototype.draw = function () {
	this.ctx.drawArrays(this.ctx[this.geometry.drawType], this.geometry.drawRange[0], this.geometry.drawRange[1]);
};

RenderWebglShader.prototype.drawElements = function () {
	this.ctx.drawElements(this.ctx[this.geometry.drawType], this.indexesObj.count, this.indexesObj.type ? this.indexesObj.type : this.ctx.UNSIGNED_SHORT, this.indexesObj.offset);
};

RenderWebglShader.prototype.updateBBox = function (argument) {
	return true;
};

RenderWebglShader.prototype.execute = function () {
	this.ctx.useProgram(this.program);
	this.applyUniforms();
	this.applyAttributes();
	// if (this.preDraw) {
	// 	this.preDraw();
	// }
	if (this.renderTarget && this.renderTarget instanceof RenderTarget) {
		this.renderTarget.update();
	}
	if (this.indexesObj) {
		this.applyIndexes();
		this.drawElements();
	} else {
		this.draw();
	}
	if (this.renderTarget && this.renderTarget instanceof RenderTarget) {
		this.renderTarget.clear();
	}
	// if (this.postDraw) {
	// 	this.postDraw();
	// }
};

RenderWebglShader.prototype.addUniform = function (key, value) {
	this.uniforms[key] = webGlUniformMapper(this.ctx, this.program, key, value);
	queueInstance.vDomChanged(this.vDomIndex);
};

RenderWebglShader.prototype.addAttribute = function (key, value) {
	this.attributes[key] = value;
	this.attrObjs[key] = webGlAttrMapper(this.ctx, this.program, key, value);
	queueInstance.vDomChanged(this.vDomIndex);
};

RenderWebglShader.prototype.setAttributeData = function (key, value) {
	this.attributes[key].value = value;
	this.attrObjs[key].value = value;
	queueInstance.vDomChanged(this.vDomIndex);
};
RenderWebglShader.prototype.applyAttributeData = function (key, value) {
	this.attributes[key].value = value;
	this.attrObjs[key].value = value;
	let d = this.attrObjs[key];
	this.ctx.bindBuffer(d.bufferType, d.buffer);
	this.ctx.bufferData(d.bufferType, this.attributes[d.attr].value, d.drawType);
	this.ctx.enableVertexAttribArray(d.attributeLocation);
	this.ctx.vertexAttribPointer(d.attributeLocation, d.size, d.valueType, true, 0, 0);
};
RenderWebglShader.prototype.setUniformData = function (key, value) {
	this.uniforms[key].value = value;
	queueInstance.vDomChanged(this.vDomIndex);
};
RenderWebglShader.prototype.applyUniformData = function (uniform, value) {
	this.uniforms[uniform].value = value;
	if (this.uniforms[uniform].matrix) {
		this.ctx[this.uniforms[uniform].type](this.uniforms[uniform].uniformLocation, this.uniforms[uniform].transpose, this.uniforms[uniform].value);
	} else {
		this.ctx[this.uniforms[uniform].type](this.uniforms[uniform].uniformLocation, this.uniforms[uniform].value);
	}
	queueInstance.vDomChanged(this.vDomIndex);
};

function ShaderNodePrototype () {}
ShaderNodePrototype.prototype.translate = function (trans) {
	this.attr.transform['translate'] = trans;
};
ShaderNodePrototype.prototype.scale = function (scale) {
	this.attr.transform['scale'] = scale;
};
ShaderNodePrototype.prototype.rotate = function (angle) {
	this.attr.transform['rotate'] = angle;
};


function RenderWebglPoints (ctx, attr, style, vDomIndex) {
	this.ctx = ctx;
	this.dom = {};
	this.attr = attr || {};
	this.style = style || {};
	this.vDomIndex = vDomIndex;

	if (!this.attr.transform) {
		this.attr.transform = {
			translate: [0.0, 0.0],
			scale: [1.0, 1.0]
		};
	}
	if (!this.attr.transform.scale) {
		this.attr.transform.scale = [1.0, 1.0];
	}
	if (!this.attr.transform.translate) {
		this.attr.transform.translate = [0.0, 0.0];
	}

	this.geometry = new PointsGeometry();
	this.geometry.setAttr('a_color', {
		value: new Float32Array([]),
		size: 4
	});
	this.geometry.setAttr('a_size', {
		value: new Float32Array([]),
		size: 1
	});
	this.geometry.setAttr('a_position', {
		value: new Float32Array([]),
		size: 2
	});

	this.shaderInstance = new RenderWebglShader(ctx, {
		fragmentShader: shaders('point').fragmentShader,
		vertexShader: shaders('point').vertexShader,
		uniforms: {
			u_resolution: {
				value: new Float32Array([1.0, 1.0])
			},
			u_translate: {
				value: new Float32Array(this.attr.transform.translate)
			},
			u_scale: {
				value: new Float32Array(this.attr.transform.scale)
			}
		},
		geometry: this.geometry
	}, vDomIndex);

	this.positionArray = [];
	this.colorArray = [];
	this.pointsSize = [];

	this.vertexUpdate = true;
	this.colorUpdate = true;
	this.sizeUpdate = true;
}

RenderWebglPoints.prototype = new ShaderNodePrototype();
RenderWebglPoints.prototype.constructor = RenderWebglPoints;

RenderWebglPoints.prototype.clear = function (index) {
	let colorArray = this.colorUpdate ? this.colorArray : this.typedColorArray;
	let ti = index * 4;

	colorArray[ti] = undefined;
	colorArray[ti + 1] = undefined;
	colorArray[ti + 2] = undefined;
	colorArray[ti + 3] = undefined;

	let positionArray = this.vertexUpdate ? this.positionArray : this.typedPositionArray;
	let len = index * 2;
	positionArray[len] = undefined;
	positionArray[len + 1] = undefined;

	let sizeArray = this.sizeUpdate ? this.pointsSize : this.typedSizeArray;
	sizeArray[index] = undefined;

	this.filterPositionFlag = true;
	this.filterColorFlag = true;
	this.filterSizeFlag = true;
};

RenderWebglPoints.prototype.updateVertex = function (index, x, y) {
	let positionArray = this.vertexUpdate ? this.positionArray : this.typedPositionArray;
	positionArray[index * 2] = x;
	positionArray[(index * 2) + 1] = y;
};

RenderWebglPoints.prototype.updateSize = function (index, size) {
	let sizeArray = this.sizeUpdate ? this.pointsSize : this.typedSizeArray;
	sizeArray[index] = size;
};

RenderWebglPoints.prototype.updateColor = function (index, fill) {
	let colorArray = this.colorUpdate ? this.colorArray : this.typedColorArray;
	colorArray[index * 4] = fill.r / 255;
	colorArray[(index * 4) + 1] = fill.g / 255;
	colorArray[(index * 4) + 2] = fill.b / 255;
	colorArray[(index * 4) + 3] = fill.a === undefined ? 1 : fill.a / 255;
};

RenderWebglPoints.prototype.addVertex = function (x, y, index) {
	this.positionArray = (this.typedPositionArray && this.typedPositionArray.length > 0) ? Array.from(this.typedPositionArray) : this.positionArray;
	this.positionArray[index * 2] = x;
	this.positionArray[(index * 2) + 1] = y;
	this.vertexUpdate = true;
};

RenderWebglPoints.prototype.addSize = function (size, index) {
	this.pointsSize = (this.typedSizeArray && this.typedSizeArray.length > 0) ? Array.from(this.typedSizeArray) : this.pointsSize;
	this.pointsSize[index] = size;
	this.sizeUpdate = true;
};

RenderWebglPoints.prototype.addColors = function (fill, index) {
	this.colorArray = (this.typedColorArray && this.typedColorArray.length > 0) ? Array.from(this.typedColorArray) : this.colorArray;
	this.colorArray[index * 4] = fill.r / 255;
	this.colorArray[(index * 4) + 1] = fill.g / 255;
	this.colorArray[(index * 4) + 2] = fill.b / 255;
	this.colorArray[(index * 4) + 3] = fill.a === undefined ? 1 : fill.a / 255;
	this.colorUpdate = true;
};

RenderWebglPoints.prototype.execute = function (stack) {
	if (this.renderTarget && this.renderTarget instanceof RenderTarget) {
		this.renderTarget.update();
	}

	if (this.vertexUpdate) {
		if (this.filterPositionFlag) {
			this.positionArray = this.positionArray.filter(function (d) {
				return !isNaN(d);
			});
			this.filterPositionFlag = false;
		}
		this.typedPositionArray = new Float32Array(this.positionArray);
		this.positionArray = [];
		this.vertexUpdate = false;
	}
	if (this.colorUpdate) {
		if (this.filterColorFlag) {
			this.colorArray = this.colorArray.filter(function (d) {
				return !isNaN(d);
			});
			this.filterColorFlag = false;
		}
		this.typedColorArray = new Float32Array(this.colorArray);
		this.colorArray = [];
		this.colorUpdate = false;
	}
	if (this.sizeUpdate) {
		if (this.filterSizeFlag) {
			this.pointsSize = this.pointsSize.filter(function (d) {
				return !isNaN(d);
			});
			this.filterSizeFlag = false;
		}
		this.typedSizeArray = new Float32Array(this.pointsSize);
		this.pointsSize = [];
		this.sizeUpdate = false;
	}
	if (this.filterPositionFlag) {
		this.typedPositionArray = this.typedPositionArray.filter(function (d) {
			return !isNaN(d);
		});
		this.filterPositionFlag = false;
	}
	if (this.filterColorFlag) {
		this.typedColorArray = this.typedColorArray.filter(function (d) {
			return !isNaN(d);
		});
		this.filterColorFlag = false;
	}
	if (this.filterSizeFlag) {
		this.typedSizeArray = this.typedSizeArray.filter(function (d) {
			return !isNaN(d);
		});
		this.filterSizeFlag = false;
	}
	this.shaderInstance.setUniformData('u_resolution', new Float32Array([this.ctx.canvas.width / ratio, this.ctx.canvas.height / ratio]));
	this.shaderInstance.setUniformData('u_scale', new Float32Array([this.attr.transform.scale[0], this.attr.transform.scale[1]]));
	this.shaderInstance.setUniformData('u_translate', new Float32Array([this.attr.transform.translate[0], this.attr.transform.translate[1]]));
	this.shaderInstance.setAttributeData('a_color', this.typedColorArray);
	this.shaderInstance.setAttributeData('a_size', this.typedSizeArray);
	this.shaderInstance.setAttributeData('a_position', this.typedPositionArray);
	this.geometry.setDrawRange(0, this.typedPositionArray.length / 2);

	this.shaderInstance.execute();
	if (this.renderTarget && this.renderTarget instanceof RenderTarget) {
		this.renderTarget.update();
	}
};

function RenderWebglRects (ctx, attr, style, renderTarget, vDomIndex) {
	this.ctx = ctx;
	this.dom = {};
	this.positionArray = [];
	this.colorArray = [];
	this.attr = attr || {};
	this.style = style || {};
	this.vDomIndex = vDomIndex;
	this.renderTarget = renderTarget;

	if (!this.attr.transform) {
		this.attr.transform = {
			translate: [0.0, 0.0],
			scale: [1.0, 1.0]
		};
	}

	this.geometry = new MeshGeometry();
	this.geometry.setAttr('a_color', {
		value: new Float32Array(this.colorArray),
		size: 4
	});
	this.geometry.setAttr('a_position', {
		value: new Float32Array(this.positionArray),
		size: 2
	});
	this.geometry.setDrawRange(0, this.positionArray.length / 2);

	this.shaderInstance = new RenderWebglShader(ctx, {
		fragmentShader: shaders('rect').fragmentShader,
		vertexShader: shaders('rect').vertexShader,
		uniforms: {
			u_resolution: {
				value: new Float32Array([1.0, 1.0])
			},
			u_translate: {
				value: new Float32Array(this.attr.transform.translate)
			},
			u_scale: {
				value: new Float32Array(this.attr.transform.scale)
			}
		},
		geometry: this.geometry
	}, vDomIndex);

	this.vertexUpdate = true;
	this.colorUpdate = true;
};

RenderWebglRects.prototype = new ShaderNodePrototype();
RenderWebglRects.prototype.constructor = RenderWebglRects;

RenderWebglRects.prototype.clear = function (index) {
	let colorArray = this.colorUpdate ? this.colorArray : this.typedColorArray;
	let ti = index * 24;

	colorArray[ti] = colorArray[ti + 4] = colorArray[ti + 8] = colorArray[ti + 12] = colorArray[ti + 16] = colorArray[ti + 20] = undefined;
	colorArray[ti + 1] = colorArray[ti + 5] = colorArray[ti + 9] = colorArray[ti + 13] = colorArray[ti + 17] = colorArray[ti + 21] = undefined;
	colorArray[ti + 2] = colorArray[ti + 6] = colorArray[ti + 10] = colorArray[ti + 14] = colorArray[ti + 18] = colorArray[ti + 22] = undefined;
	colorArray[ti + 3] = colorArray[ti + 7] = colorArray[ti + 11] = colorArray[ti + 15] = colorArray[ti + 19] = colorArray[ti + 23] = undefined;

	let positionArray = this.vertexUpdate ? this.positionArray : this.typedPositionArray;
	let len = index * 12;
	positionArray[len] = positionArray[len + 4] = positionArray[len + 6] = undefined;
	positionArray[len + 2] = positionArray[len + 8] = positionArray[len + 10] = undefined;
	positionArray[len + 1] = positionArray[len + 3] = positionArray[len + 9] = undefined;
	positionArray[len + 5] = positionArray[len + 7] = positionArray[len + 11] = undefined;

	this.filterPositionFlag = true;
	this.filterColorFlag = true;
};

RenderWebglRects.prototype.updateVertexX = function (index, x, width) {
	let positionArray = this.vertexUpdate ? this.positionArray : this.typedPositionArray;
	let len = index * 12;
	let x1 = x + width;
	if (isNaN(positionArray[len])) {
		console.log('overriding Nan');
	}
	positionArray[len] = positionArray[len + 4] = positionArray[len + 6] = x;
	positionArray[len + 2] = positionArray[len + 8] = positionArray[len + 10] = x1;
};

RenderWebglRects.prototype.updateVertexY = function (index, y, height) {
	let positionArray = this.vertexUpdate ? this.positionArray : this.typedPositionArray;
	let len = index * 12;
	let y1 = y + height;
	positionArray[len + 1] = positionArray[len + 3] = positionArray[len + 9] = y;
	positionArray[len + 5] = positionArray[len + 7] = positionArray[len + 11] = y1;
};

RenderWebglRects.prototype.updateColor = function (index, fill) {
	let colorArray = this.colorUpdate ? this.colorArray : this.typedColorArray;
	let ti = index * 24;
	if (isNaN(colorArray[ti])) {
		console.log('overriding Nan');
	}
	colorArray[ti] = colorArray[ti + 4] = colorArray[ti + 8] = colorArray[ti + 12] = colorArray[ti + 16] = colorArray[ti + 20] = fill.r / 255;
	colorArray[ti + 1] = colorArray[ti + 5] = colorArray[ti + 9] = colorArray[ti + 13] = colorArray[ti + 17] = colorArray[ti + 21] = fill.g / 255;
	colorArray[ti + 2] = colorArray[ti + 6] = colorArray[ti + 10] = colorArray[ti + 14] = colorArray[ti + 18] = colorArray[ti + 22] = fill.b / 255;
	colorArray[ti + 3] = colorArray[ti + 7] = colorArray[ti + 11] = colorArray[ti + 15] = colorArray[ti + 19] = colorArray[ti + 23] = fill.a === undefined ? 1 : fill.a / 255;
};

RenderWebglRects.prototype.addVertex = function (x, y, width, height, index) {
	this.positionArray = (this.typedPositionArray && this.typedPositionArray.length > 0) ? Array.from(this.typedPositionArray) : this.positionArray;
	this.typedPositionArray = null;
	let len = index * 12;
	let x1 = x + width;
	let y1 = y + height;

	this.positionArray[len] = this.positionArray[len + 4] = this.positionArray[len + 6] = x;
	this.positionArray[len + 1] = this.positionArray[len + 3] = this.positionArray[len + 9] = y;
	this.positionArray[len + 2] = this.positionArray[len + 8] = this.positionArray[len + 10] = x1;
	this.positionArray[len + 5] = this.positionArray[len + 7] = this.positionArray[len + 11] = y1;
	this.vertexUpdate = true;
};

RenderWebglRects.prototype.addColors = function (fill, index) {
	this.colorArray = (this.typedColorArray && this.typedColorArray.length > 0) ? Array.from(this.typedColorArray) : this.colorArray;
	this.typedColorArray = null;
	let ti = index * 24;
	this.colorArray[ti] = this.colorArray[ti + 4] = this.colorArray[ti + 8] = this.colorArray[ti + 12] = this.colorArray[ti + 16] = this.colorArray[ti + 20] = fill.r / 255;
	this.colorArray[ti + 1] = this.colorArray[ti + 5] = this.colorArray[ti + 9] = this.colorArray[ti + 13] = this.colorArray[ti + 17] = this.colorArray[ti + 21] = fill.g / 255;
	this.colorArray[ti + 2] = this.colorArray[ti + 6] = this.colorArray[ti + 10] = this.colorArray[ti + 14] = this.colorArray[ti + 18] = this.colorArray[ti + 22] = fill.b / 255;
	this.colorArray[ti + 3] = this.colorArray[ti + 7] = this.colorArray[ti + 11] = this.colorArray[ti + 15] = this.colorArray[ti + 19] = this.colorArray[ti + 23] = fill.a === undefined ? 1 : fill.a / 255;
	this.colorUpdate = true;
};

RenderWebglRects.prototype.execute = function (stack) {
	if (this.renderTarget && this.renderTarget instanceof RenderTarget) {
		this.renderTarget.update();
	}
	if (this.vertexUpdate) {
		if (this.filterPositionFlag) {
			this.positionArray = this.positionArray.filter(function (d) {
				return !isNaN(d);
			});
			this.filterPositionFlag = false;
		}
		this.typedPositionArray = new Float32Array(this.positionArray);
		this.positionArray = [];
		this.vertexUpdate = false;
	}
	if (this.colorUpdate) {
		if (this.filterColorFlag) {
			this.colorArray = this.colorArray.filter(function (d) {
				return !isNaN(d);
			});
			this.filterColorFlag = false;
		}
		this.typedColorArray = new Float32Array(this.colorArray);
		this.colorArray = [];
		this.colorUpdate = false;
	}
	if (this.filterPositionFlag) {
		this.typedPositionArray = this.typedPositionArray.filter(function (d) {
			return !isNaN(d);
		});
		this.filterPositionFlag = false;
	}
	if (this.filterColorFlag) {
		this.typedColorArray = this.typedColorArray.filter(function (d) {
			return !isNaN(d);
		});
		this.filterColorFlag = false;
	}
	this.shaderInstance.setAttributeData('a_color', this.typedColorArray);
	this.shaderInstance.setAttributeData('a_position', this.typedPositionArray);
	this.geometry.setDrawRange(0, this.typedPositionArray.length / 2);
	this.shaderInstance.setUniformData('u_resolution', new Float32Array([this.ctx.canvas.width / ratio, this.ctx.canvas.height / ratio]));
	this.shaderInstance.setUniformData('u_scale', new Float32Array([this.attr.transform.scale[0], this.attr.transform.scale[1]]));
	this.shaderInstance.setUniformData('u_translate', new Float32Array([this.attr.transform.translate[0], this.attr.transform.translate[1]]));
	this.shaderInstance.execute();
	if (this.renderTarget && this.renderTarget instanceof RenderTarget) {
		this.renderTarget.clear();
	}
};

function RenderWebglLines (ctx, attr, style, renderTarget, vDomIndex) {
	this.ctx = ctx;
	this.dom = {};
	this.attr = attr || {};
	this.style = style || {};
	this.vDomIndex = vDomIndex;
	this.positionArray = [];
	this.colorArray = [];
	this.vertexUpdate = true;
	this.colorUpdate = true;
	this.renderTarget = renderTarget;

	if (!this.attr.transform) {
		this.attr.transform = {
			translate: [0.0, 0.0],
			scale: [1.0, 1.0]
		};
	}

	this.geometry = new LineGeometry();
	this.geometry.setAttr('a_color', {
		value: new Float32Array(this.colorArray),
		size: 4
	});
	this.geometry.setAttr('a_position', {
		value: new Float32Array(this.positionArray),
		size: 2
	});
	
	this.geometry.setDrawRange(0, this.positionArray.length / 2);

	this.shaderInstance = new RenderWebglShader(ctx, {
		fragmentShader: shaders('line').fragmentShader,
		vertexShader: shaders('line').vertexShader,
		uniforms: {
			u_resolution: {
				value: new Float32Array([1.0, 1.0])
			},
			u_translate: {
				value: new Float32Array(this.attr.transform.translate)
			},
			u_scale: {
				value: new Float32Array(this.attr.transform.scale)
			}
		},
		geometry: this.geometry
	}, vDomIndex);
}

RenderWebglLines.prototype = new ShaderNodePrototype();
RenderWebglLines.prototype.constructor = RenderWebglLines;

RenderWebglLines.prototype.clear = function (index) {
	let colorArray = this.colorUpdate ? this.colorArray : this.typedColorArray;
	let ti = index * 8;

	colorArray[ti] = undefined;
	colorArray[ti + 1] = undefined;
	colorArray[ti + 2] = undefined;
	colorArray[ti + 3] = undefined;
	colorArray[ti + 4] = undefined;
	colorArray[ti + 5] = undefined;
	colorArray[ti + 6] = undefined;
	colorArray[ti + 7] = undefined;

	let positionArray = this.vertexUpdate ? this.positionArray : this.typedPositionArray;
	let len = index * 4;
	positionArray[len] = undefined;
	positionArray[len + 1] = undefined;
	positionArray[len + 2] = undefined;
	positionArray[len + 3] = undefined;

	colorArray[ti] = undefined;
	colorArray[ti + 1] = undefined;

	this.filterPositionFlag = true;
	this.filterColorFlag = true;
};

RenderWebglLines.prototype.updateVertex = function (index, x1, y1, x2, y2) {
	let positionArray = this.vertexUpdate ? this.positionArray : this.typedPositionArray;
	let len = index * 4;
	positionArray[len] = x1;
	positionArray[len + 1] = y1;
	positionArray[len + 2] = x2;
	positionArray[len + 3] = y2;
};

RenderWebglLines.prototype.updateColor = function (i, stroke) {
	let colorArray = this.vertexUpdate ? this.colorArray : this.typedColorArray;
	colorArray[i * 8] = stroke.r / 255;
	colorArray[(i * 8) + 1] = stroke.g / 255;
	colorArray[(i * 8) + 2] = stroke.b / 255;
	colorArray[(i * 8) + 3] = stroke.a === undefined ? 1 : stroke.a / 255;
	colorArray[(i * 8) + 4] = stroke.r / 255;
	colorArray[(i * 8) + 5] = stroke.g / 255;
	colorArray[(i * 8) + 6] = stroke.b / 255;
	colorArray[(i * 8) + 7] = stroke.a === undefined ? 1 : stroke.a / 255;
};

RenderWebglLines.prototype.addVertex = function (x1, y1, x2, y2, index) {
	this.positionArray = (this.typedPositionArray && this.typedPositionArray.length > 0) ? Array.from(this.typedPositionArray) : this.positionArray;
	this.positionArray[index * 4] = x1;
	this.positionArray[(index * 4) + 1] = y1;
	this.positionArray[(index * 4) + 2] = x2;
	this.positionArray[(index * 4) + 3] = y2;
	this.vertexUpdate = true;
};

RenderWebglLines.prototype.addColors = function (stroke, index) {
	this.colorArray = (this.typedColorArray && this.typedColorArray.length > 0) ? Array.from(this.typedColorArray) : this.colorArray;
	this.colorArray[index * 8] = stroke.r / 255;
	this.colorArray[(index * 8) + 1] = stroke.g / 255;
	this.colorArray[(index * 8) + 2] = stroke.b / 255;
	this.colorArray[(index * 8) + 3] = stroke.a === undefined ? 1 : stroke.a / 255;
	this.colorArray[(index * 8) + 4] = stroke.r / 255;
	this.colorArray[(index * 8) + 5] = stroke.g / 255;
	this.colorArray[(index * 8) + 6] = stroke.b / 255;
	this.colorArray[(index * 8) + 7] = stroke.a === undefined ? 1 : stroke.a / 255;
	this.colorUpdate = true;
};

RenderWebglLines.prototype.execute = function (stack) {
	if (this.renderTarget && this.renderTarget instanceof RenderTarget) {
		this.renderTarget.update();
	}
	if (this.vertexUpdate) {
		if (this.filterPositionFlag) {
			this.positionArray = this.positionArray.filter(function (d) {
				return !isNaN(d);
			});
			this.filterPositionFlag = false;
		}
		this.typedPositionArray = new Float32Array(this.positionArray);
		this.positionArray = [];
		this.vertexUpdate = false;
	}
	if (this.colorUpdate) {
		if (this.filterColorFlag) {
			this.colorArray = this.colorArray.filter(function (d) {
				return !isNaN(d);
			});
			this.filterColorFlag = false;
		}
		this.typedColorArray = new Float32Array(this.colorArray);
		this.colorArray = [];
		this.colorUpdate = false;
	}
	if (this.filterPositionFlag) {
		this.typedPositionArray = this.typedPositionArray.filter(function (d) {
			return !isNaN(d);
		});
		this.filterPositionFlag = false;
	}
	if (this.filterColorFlag) {
		this.typedColorArray = this.typedColorArray.filter(function (d) {
			return !isNaN(d);
		});
		this.filterColorFlag = false;
	}

	this.shaderInstance.setAttributeData('a_color', this.typedColorArray);
	this.shaderInstance.setAttributeData('a_position', this.typedPositionArray);
	this.geometry.setDrawRange(0, this.typedPositionArray.length / 2);
	this.shaderInstance.setUniformData('u_resolution', new Float32Array([this.ctx.canvas.width / ratio, this.ctx.canvas.height / ratio]));
	this.shaderInstance.setUniformData('u_scale', new Float32Array([this.attr.transform.scale[0], this.attr.transform.scale[1]]));
	this.shaderInstance.setUniformData('u_translate', new Float32Array([this.attr.transform.translate[0], this.attr.transform.translate[1]]));
	this.shaderInstance.execute();
	if (this.renderTarget && this.renderTarget instanceof RenderTarget) {
		this.renderTarget.clear();
	}
};

function RenderWebglPolyLines (ctx, attr, style, renderTarget, vDomIndex) {
	this.ctx = ctx;
	this.dom = {};
	this.attr = attr || {};
	this.style = style || {};
	this.vDomIndex = vDomIndex;
	this.positionArray = [];
	this.colorArray = [];
	this.renderTarget = renderTarget;

	if (!this.attr.transform) {
		this.attr.transform = {
			translate: [0.0, 0.0],
			scale: [1.0, 1.0]
		};
	}

	this.geometry = new LineGeometry();
	this.geometry.drawType = 'LINE_STRIP';
	this.geometry.setAttr('a_position', {
		value: new Float32Array(this.positionArray),
		size: 2
	});
	this.geometry.setDrawRange(0, this.positionArray.length / 2);

	this.shaderInstance = new RenderWebglShader(ctx, {
		fragmentShader: shaders('polyline').fragmentShader,
		vertexShader: shaders('polyline').vertexShader,
		uniforms: {
			u_resolution: {
				value: new Float32Array([1.0, 1.0])
			},
			u_translate: {
				value: new Float32Array(this.attr.transform.translate)
			},
			u_scale: {
				value: new Float32Array(this.attr.transform.scale)
			},
			u_color: {
				value: new Float32Array(4)
			}
		},
		geometry: this.geometry
	}, vDomIndex);
}

RenderWebglPolyLines.prototype = new ShaderNodePrototype();
RenderWebglPolyLines.prototype.constructor = RenderWebglPolyLines;

RenderWebglPolyLines.prototype.clear = function (index) {
	this.positionArray[index] = undefined;
	this.colorArray[index] = undefined;
	this.filterColorFlag = true;
	this.filterPositionFlag = true;
};

RenderWebglPolyLines.prototype.updateVertex = function (index, points) {
	let subPoints = [];
	for (let j = 0, jlen = points.length; j < jlen; j++) {
		subPoints[j * 2] = points[j].x;
		subPoints[(j * 2) + 1] = points[j].y;
	}
	this.positionArray[index] = new Float32Array(subPoints);
};

RenderWebglPolyLines.prototype.updateColor = function (index, fill) {
	this.colorArray[index] = new Float32Array([fill.r / 255, fill.g / 255, fill.b / 255, fill.a === undefined ? 1 : fill.a / 255]);
};

RenderWebglPolyLines.prototype.addVertex = function (points, index) {
	let positionArray = this.positionArray;
	let subPoints = [];

	for (let j = 0, jlen = points.length; j < jlen; j++) {
		subPoints[j * 2] = points[j].x;
		subPoints[(j * 2) + 1] = points[j].y;
	}

	positionArray[index] = new Float32Array(subPoints);
	this.vertexUpdate = true;
};

RenderWebglPolyLines.prototype.addColors = function (fill, index) {
	this.colorArray[index] = new Float32Array([fill.r / 255, fill.g / 255, fill.b / 255, fill.a === undefined ? 1 : fill.a / 255]);
	this.colorUpdate = true;
};

RenderWebglPolyLines.prototype.execute = function (stack) {
	if (this.renderTarget && this.renderTarget instanceof RenderTarget) {
		this.renderTarget.update();
	}

	if (!this.attr.transform.scale) {
		this.attr.transform.scale = [1.0, 1.0];
	}

	if (!this.attr.transform.translate) {
		this.attr.transform.translate = [0.0, 0.0];
	}

	if (this.filterPositionFlag) {
		this.positionArray = this.positionArray.filter(function (d) {
			return d;
		});
		this.filterPositionFlag = false;
	}
	if (this.filterColorFlag) {
		this.colorArray = this.colorArray.filter(function (d) {
			return d;
		});
		this.filterColorFlag = false;
	}

	this.shaderInstance.setUniformData('u_resolution', new Float32Array([this.ctx.canvas.width / ratio, this.ctx.canvas.height / ratio]));
	this.shaderInstance.setUniformData('u_scale', new Float32Array([this.attr.transform.scale[0], this.attr.transform.scale[1]]));
	this.shaderInstance.setUniformData('u_translate', new Float32Array([this.attr.transform.translate[0], this.attr.transform.translate[1]]));

	for (let i = 0, len = this.positionArray.length; i < len; i++) {
		// this.shaderInstance.setAttributeData('a_color', this.colorArray[i]);
		this.shaderInstance.setAttributeData('a_position', this.positionArray[i]);
		this.shaderInstance.setUniformData('u_color', this.colorArray[i]);
		this.geometry.setDrawRange(0, this.positionArray[i].length / 2);
		this.shaderInstance.execute();
	}
	if (this.renderTarget && this.renderTarget instanceof RenderTarget) {
		this.renderTarget.clear();
	}
};

function RenderWebglPolygons (ctx, attr, style, renderTarget, vDomIndex) {
	this.ctx = ctx;
	this.dom = {};
	this.attr = attr || {};
	this.style = style || {};
	this.vDomIndex = vDomIndex;
	this.colorArray = [];
	this.positionArray = [];
	this.renderTarget = renderTarget;

	if (!this.attr.transform) {
		this.attr.transform = {
			translate: [0.0, 0.0],
			scale: [1.0, 1.0]
		};
	}

	this.geometry = new MeshGeometry();

	this.geometry.setAttr('a_position', {
		value: new Float32Array([]),
		size: 2
	});

	this.shaderInstance = new RenderWebglShader(ctx, {
		fragmentShader: shaders('polygon').fragmentShader,
		vertexShader: shaders('polygon').vertexShader,
		uniforms: {
			u_resolution: {
				value: new Float32Array([1.0, 1.0])
			},
			u_translate: {
				value: new Float32Array(this.attr.transform.translate)
			},
			u_scale: {
				value: new Float32Array(this.attr.transform.scale)
			},
			u_color: {
				value: new Float32Array(4)
			}
		},
		geometry: this.geometry
	}, vDomIndex);
}

RenderWebglPolygons.prototype = new ShaderNodePrototype();
RenderWebglPolygons.prototype.constructor = RenderWebglPolygons;

RenderWebglPolygons.prototype.clear = function (index) {
	this.positionArray[index] = undefined;
	this.colorArray[index] = undefined;
	this.filterColorFlag = true;
	this.filterPositionFlag = true;
};

RenderWebglPolygons.prototype.updateVertex = function (index, points) {
	let subPoints = [];
	for (let j = 0, jlen = points.length; j < jlen; j++) {
		subPoints[j * 2] = points[j].x;
		subPoints[(j * 2) + 1] = points[j].y;
	}
	this.positionArray[index] = new Float32Array(subPoints);
};

RenderWebglPolygons.prototype.updateColor = function (index, fill) {
	this.colorArray[index] = new Float32Array([fill.r / 255, fill.g / 255, fill.b / 255, fill.a === undefined ? 1 : fill.a / 255]);
};

RenderWebglPolygons.prototype.addVertex = function (points, index) {
	let positionArray = this.positionArray;
	let subPoints = [];

	for (let j = 0, jlen = points.length; j < jlen; j++) {
		subPoints[j * 2] = points[j].x;
		subPoints[(j * 2) + 1] = points[j].y;
	}

	positionArray[index] = new Float32Array(subPoints);
	this.vertexUpdate = true;
};

RenderWebglPolygons.prototype.addColors = function (fill, index) {
	this.colorArray[index] = new Float32Array([fill.r / 255, fill.g / 255, fill.b / 255, fill.a === undefined ? 1 : fill.a / 255]);
	this.colorUpdate = true;
};

RenderWebglPolygons.prototype.execute = function (stack) {
	if (this.renderTarget && this.renderTarget instanceof RenderTarget) {
		this.renderTarget.update();
	}

	if (!this.attr.transform.scale) {
		this.attr.transform.scale = [1.0, 1.0];
	}

	if (!this.attr.transform.translate) {
		this.attr.transform.translate = [0.0, 0.0];
	}

	if (this.filterPositionFlag) {
		this.positionArray = this.positionArray.filter(function (d) {
			return d;
		});
		this.filterPositionFlag = false;
	}
	if (this.filterColorFlag) {
		this.colorArray = this.colorArray.filter(function (d) {
			return d;
		});
		this.filterColorFlag = false;
	}

	this.shaderInstance.useProgram();
	this.shaderInstance.applyUniformData('u_resolution', new Float32Array([this.ctx.canvas.width / ratio, this.ctx.canvas.height / ratio]));
	this.shaderInstance.applyUniformData('u_scale', new Float32Array([this.attr.transform.scale[0], this.attr.transform.scale[1]]));
	this.shaderInstance.applyUniformData('u_translate', new Float32Array([this.attr.transform.translate[0], this.attr.transform.translate[1]]));

	for (let i = 0, len = this.positionArray.length; i < len; i++) {
		this.shaderInstance.setUniformData('u_color', this.colorArray[i]);
		this.shaderInstance.setAttributeData('a_position', this.positionArray[i]);
		this.geometry.setDrawRange(0, this.positionArray[i].length / 2);
		this.shaderInstance.execute();
	}
	if (this.renderTarget && this.renderTarget instanceof RenderTarget) {
		this.renderTarget.clear();
	}
};

function RenderWebglCircles (ctx, attr, style, renderTarget, vDomIndex) {
	this.ctx = ctx;
	this.dom = {};
	this.attr = attr || {};
	this.style = style || {};
	this.vDomIndex = vDomIndex;
	this.positionArray = [];
	this.colorArray = [];
	this.pointsSize = [];
	this.renderTarget = renderTarget;

	if (!this.attr.transform) {
		this.attr.transform = {
			translate: [0.0, 0.0],
			scale: [1.0, 1.0]
		};
	}

	this.geometry = new PointsGeometry();
	this.geometry.setAttr('a_color', {
		value: new Float32Array(this.colorArray),
		size: 4
	});
	this.geometry.setAttr('a_radius', {
		value: new Float32Array(this.pointsSize),
		size: 1
	});
	this.geometry.setAttr('a_position', {
		value: new Float32Array(this.positionArray),
		size: 2
	});
	
	this.geometry.setDrawRange(0, 0);

	this.shaderInstance = new RenderWebglShader(ctx, {
		fragmentShader: shaders('circle').fragmentShader,
		vertexShader: shaders('circle').vertexShader,
		uniforms: {
			u_resolution: {
				value: new Float32Array([1.0, 1.0])
			},
			u_translate: {
				value: new Float32Array(this.attr.transform.translate)
			},
			u_scale: {
				value: new Float32Array(this.attr.transform.scale)
			}
		},
		geometry: this.geometry
	}, vDomIndex);

	this.vertexUpdate = true;
	this.colorUpdate = true;
	this.sizeUpdate = true;
};

RenderWebglCircles.prototype = new ShaderNodePrototype();
RenderWebglCircles.prototype.constructor = RenderWebglCircles;

RenderWebglCircles.prototype.clear = function (index) {
	let colorArray = this.colorUpdate ? this.colorArray : this.typedColorArray;
	let ti = index * 4;

	colorArray[ti] = undefined;
	colorArray[ti + 1] = undefined;
	colorArray[ti + 2] = undefined;
	colorArray[ti + 3] = undefined;

	let positionArray = this.vertexUpdate ? this.positionArray : this.typedPositionArray;
	let len = index * 2;
	positionArray[len] = undefined;
	positionArray[len + 1] = undefined;

	let sizeArray = this.sizeUpdate ? this.pointsSize : this.typedSizeArray;
	sizeArray[index] = undefined;

	this.filterPositionFlag = true;
	this.filterColorFlag = true;
	this.filterSizeFlag = true;
};

RenderWebglCircles.prototype.updateVertex = function (index, x, y) {
	let positionArray = this.vertexUpdate ? this.positionArray : this.typedPositionArray;
	positionArray[index * 2] = x;
	positionArray[(index * 2) + 1] = y;
};

RenderWebglCircles.prototype.updateColor = function (index, fill) {
	let colorArray = this.colorUpdate ? this.colorArray : this.typedColorArray;
	colorArray[index * 4] = fill.r / 255;
	colorArray[(index * 4) + 1] = fill.g / 255;
	colorArray[(index * 4) + 2] = fill.b / 255;
	colorArray[(index * 4) + 3] = fill.a === undefined ? 1 : fill.a / 255;
};

RenderWebglCircles.prototype.updateSize = function (index, value) {
	let sizeArray = this.sizeUpdate ? this.pointsSize : this.typedSizeArray;
	sizeArray[index] = value;
};

RenderWebglCircles.prototype.addVertex = function (x, y, index) {
	this.positionArray = (this.typedPositionArray && this.typedPositionArray.length > 0) ? Array.from(this.typedPositionArray) : this.positionArray;
	this.positionArray[index * 2] = x;
	this.positionArray[(index * 2) + 1] = y;
	this.vertexUpdate = true;
};

RenderWebglCircles.prototype.addSize = function (size, index) {
	this.pointsSize = (this.typedSizeArray && this.typedSizeArray.length > 0) ? Array.from(this.typedSizeArray) : this.pointsSize;
	this.pointsSize[index] = size;
	this.sizeUpdate = true;
};

RenderWebglCircles.prototype.addColors = function (fill, index) {
	this.colorArray = (this.typedColorArray && this.typedColorArray.length > 0) ? Array.from(this.typedColorArray) : this.colorArray;
	this.colorArray[index * 4] = fill.r / 255;
	this.colorArray[(index * 4) + 1] = fill.g / 255;
	this.colorArray[(index * 4) + 2] = fill.b / 255;
	this.colorArray[(index * 4) + 3] = fill.a === undefined ? 1 : fill.a / 255;
	this.colorUpdate = true;
};

RenderWebglCircles.prototype.execute = function (stack) {
	if (this.renderTarget && this.renderTarget instanceof RenderTarget) {
		this.renderTarget.update();
	}

	if (!this.attr.transform.scale) {
		this.attr.transform.scale = [1.0, 1.0];
	}

	if (!this.attr.transform.translate) {
		this.attr.transform.translate = [0.0, 0.0];
	}

	if (this.vertexUpdate) {
		if (this.filterPositionFlag) {
			this.positionArray = this.positionArray.filter(function (d) {
				return !isNaN(d);
			});
			this.filterPositionFlag = false;
		}
		this.typedPositionArray = new Float32Array(this.positionArray);
		this.positionArray = [];
		this.vertexUpdate = false;
	}
	if (this.colorUpdate) {
		if (this.filterColorFlag) {
			this.colorArray = this.colorArray.filter(function (d) {
				return !isNaN(d);
			});
			this.filterColorFlag = false;
		}
		this.typedColorArray = new Float32Array(this.colorArray);
		this.colorArray = [];
		this.colorUpdate = false;
	}
	if (this.sizeUpdate) {
		if (this.filterSizeFlag) {
			this.pointsSize = this.pointsSize.filter(function (d) {
				return !isNaN(d);
			});
			this.filterSizeFlag = false;
		}
		this.typedSizeArray = new Float32Array(this.pointsSize);
		this.pointsSize = [];
		this.sizeUpdate = false;
	}
	if (this.filterPositionFlag) {
		this.typedPositionArray = this.typedPositionArray.filter(function (d) {
			return !isNaN(d);
		});
		this.filterPositionFlag = false;
	}
	if (this.filterColorFlag) {
		this.typedColorArray = this.typedColorArray.filter(function (d) {
			return !isNaN(d);
		});
		this.filterColorFlag = false;
	}
	if (this.filterSizeFlag) {
		this.typedSizeArray = this.typedSizeArray.filter(function (d) {
			return !isNaN(d);
		});
		this.filterSizeFlag = false;
	}

	this.shaderInstance.setUniformData('u_resolution', new Float32Array([this.ctx.canvas.width / ratio, this.ctx.canvas.height / ratio]));
	this.shaderInstance.setUniformData('u_scale', new Float32Array([this.attr.transform.scale[0], this.attr.transform.scale[1]]));
	this.shaderInstance.setUniformData('u_translate', new Float32Array([this.attr.transform.translate[0], this.attr.transform.translate[1]]));
	this.shaderInstance.setAttributeData('a_radius', this.typedSizeArray);
	this.shaderInstance.setAttributeData('a_color', this.typedColorArray);
	this.shaderInstance.setAttributeData('a_position', this.typedPositionArray);

	this.geometry.setDrawRange(0, this.typedPositionArray.length / 2);
	this.shaderInstance.execute();
	if (this.renderTarget && this.renderTarget instanceof RenderTarget) {
		this.renderTarget.clear();
	}
};

function RenderWebglImages (ctx, attr, style, renderTarget, vDomIndex) {
	this.ctx = ctx;
	this.dom = {};
	this.attr = attr || {};
	this.style = style || {};
	this.vDomIndex = vDomIndex;
	this.textCoor = new Float32Array([0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0]);
	this.renderTarget = renderTarget;

	if (!this.attr.transform) {
		this.attr.transform = {
			translate: [0.0, 0.0],
			scale: [1.0, 1.0]
		};
	}

	this.geometry = new MeshGeometry();
	this.geometry.setAttr('a_texCoord', {
		value: this.textCoor,
		size: 2
	});
	this.geometry.setAttr('a_position', {
		value: new Float32Array([0, 0]),
		size: 2
	});
	this.geometry.setDrawRange(0, 6);

	this.shaderInstance = new RenderWebglShader(ctx, {
		fragmentShader: shaders('image').fragmentShader,
		vertexShader: shaders('image').vertexShader,
		uniforms: {
			u_resolution: {
				value: new Float32Array([1.0, 1.0])
			},
			u_translate: {
				value: new Float32Array(this.attr.transform.translate)
			},
			u_scale: {
				value: new Float32Array(this.attr.transform.scale)
			},
			u_image: {
				value: new TextureObject(this.ctx, {}, this.vDomIndex)
			},
			u_opacity: {
				value: (1.0).toFixed(2)
			}
		},
		geometry: this.geometry
	}, vDomIndex);

	this.positionArray = [];
	this.vertexUpdate = true;
};

RenderWebglImages.prototype = new ShaderNodePrototype();
RenderWebglImages.prototype.constructor = RenderWebglImages;

RenderWebglImages.prototype.clear = function (index) {
	this.positionArray[index] = undefined;
	this.filterPositionFlag = true;
};

RenderWebglImages.prototype.updateVertexX = function (index, x, width) {
	let positionArray = this.positionArray[index];
	let x1 = x + width;
	positionArray[0] = positionArray[4] = positionArray[6] = x;
	positionArray[2] = positionArray[8] = positionArray[10] = x1;
};

RenderWebglImages.prototype.updateVertexY = function (index, y, height) {
	let positionArray = this.positionArray[index];
	let y1 = y + height;
	positionArray[1] = positionArray[3] = positionArray[9] = y;
	positionArray[5] = positionArray[7] = positionArray[11] = y1;
};

RenderWebglImages.prototype.addVertex = function (x, y, width, height, index) {
	let positionArray = new Float32Array(12);
	let x1 = x + width;
	let y1 = y + height;

	positionArray[0] = positionArray[4] = positionArray[6] = x;
	positionArray[1] = positionArray[3] = positionArray[9] = y;
	positionArray[2] = positionArray[8] = positionArray[10] = x1;
	positionArray[5] = positionArray[7] = positionArray[11] = y1;

	this.positionArray[index] = positionArray;

	this.vertexUpdate = true;
};

// RenderWebglImages.prototype.addOpacity = function (value, index) {
// 	this.opacityArray[index] = value;
// 	this.opacityUpdate = true;
// };

// RenderWebglImages.prototype.updateOpacity = function (index, value) {
// 	let opacityArray = this.opacityUpdate ? this.opacityArray : this.typedOpacityArray;
// 	opacityArray[index] = value;
// };

RenderWebglImages.prototype.execute = function (stack) {
	if (this.renderTarget && this.renderTarget instanceof RenderTarget) {
		this.renderTarget.update();
	}

	this.shaderInstance.useProgram();

	if (!this.attr.transform.scale) {
		this.attr.transform.scale = [1.0, 1.0];
	}

	if (!this.attr.transform.translate) {
		this.attr.transform.translate = [0.0, 0.0];
	}

	this.shaderInstance.applyUniformData('u_resolution', new Float32Array([this.ctx.canvas.width / ratio, this.ctx.canvas.height / ratio]));
	this.shaderInstance.applyUniformData('u_scale', this.attr.transform.scale);
	this.shaderInstance.applyUniformData('u_translate', this.attr.transform.translate);
	this.shaderInstance.applyAttributeData('a_texCoord', this.textCoor);

	if (this.filterPositionFlag) {
		this.positionArray = this.positionArray.filter(function (d) {
			return d;
		});
		this.filterPositionFlag = false;
	}

	for (var i = 0, len = stack.length; i < len; i++) {
		let node = stack[i];
		if (!node.dom.textureNode) {
			continue;
		}
		if (node.style.display === 'none') {
			continue;
		}
		// if (typeof node.attr.src === 'string') {
			
		// 	node.textureNode.loadTexture();
		// 	this.shaderInstance.applyUniformData('u_image', node.textureNode);
		// } else if (node.attr.src instanceof TextureObject) {
		// 	node.attr.src.loadTexture();
		// 	this.shaderInstance.applyUniformData('u_image', node.attr.src);
		// }
		let op = node.style.opacity !== undefined ? node.style.opacity : (this.style.opacity !== undefined ? this.style.opacity : 1.0);
		node.dom.textureNode.loadTexture();
		this.shaderInstance.applyUniformData('u_image', node.dom.textureNode);
		this.shaderInstance.applyAttributeData('a_position', this.positionArray[i]);
		this.shaderInstance.applyUniformData('u_opacity', op);
		this.shaderInstance.draw();
	}

	if (this.renderTarget && this.renderTarget instanceof RenderTarget) {
		this.renderTarget.clear();
	}
};

function getTypeShader (ctx, attr, style, type, renderTarget, vDomIndex) {
	let e;

	switch (type) {
		case 'rect':
			e = new RenderWebglRects(ctx, attr, style, renderTarget, vDomIndex);
			break;

		case 'point':
			e = new RenderWebglPoints(ctx, attr, style, renderTarget, vDomIndex);
			break;

		case 'line':
			e = new RenderWebglLines(ctx, attr, style, renderTarget, vDomIndex);
			break;

		case 'polyline':
			e = new RenderWebglPolyLines(ctx, attr, style, renderTarget, vDomIndex);
			break;

		case 'polygon':
			e = new RenderWebglPolygons(ctx, attr, style, renderTarget, vDomIndex);
			break;

		case 'circle':
			e = new RenderWebglCircles(ctx, attr, style, renderTarget, vDomIndex);
			break;

		case 'image':
			e = new RenderWebglImages(ctx, attr, style, renderTarget, vDomIndex);
			break;

		case 'text':
			e = new RenderWebglImages(ctx, attr, style, renderTarget, vDomIndex);
			break;

		default:
			e = null;
			break;
	}

	return e;
}

function WebglNodeExe (ctx, config, id, vDomIndex) {
	this.ctx = ctx;
	this.style = config.style || {};
	this.attr = config.attr || {};
	this.id = id;
	this.nodeName = config.el;
	this.nodeType = 'WEBGL';
	this.children = [];
	this.ctx = ctx;
	this.vDomIndex = vDomIndex;
	this.el = config.el;
	this.shaderType = config.shaderType;
	this.exeCtx = config.ctx;
	this.bbox = config['bbox'] !== undefined ? config['bbox'] : true;
	this.events = {};

	switch (config.el) {
		case 'point':
			this.dom = new PointNode(this.attr, this.style);
			break;

		case 'rect':
			this.dom = new RectNode(this.attr, this.style);
			break;

		case 'line':
			this.dom = new LineNode(this.attr, this.style);
			break;

		case 'polyline':
			this.dom = new PolyLineNode(this.attr, this.style);
			break;

		case 'polygon':
			this.dom = new PolygonNode(this.attr, this.style);
			break;

		case 'circle':
			this.dom = new CircleNode(this.attr, this.style);
			break;

		case 'image':
			this.dom = new ImageNode(this.ctx, this.attr, this.style, vDomIndex);
			break;

		case 'text':
			this.dom = new TextNode(this.ctx, this.attr, this.style, vDomIndex);
			break;

		case 'group':
			this.dom = new WebglGroupNode(this.ctx, this.attr, this.style, config.renderTarget, vDomIndex);
			break;

		default:
			this.dom = null;
			break;
	}

	this.dom.nodeExe = this;
	if (!(this.dom instanceof WebglGroupNode)) {
		delete this.createEl;
		delete this.createEls;
	}
}

WebglNodeExe.prototype = new NodePrototype();

WebglNodeExe.prototype.reIndexChildren = function () {
	this.children = this.children.filter(function (d) {
		return d;
	});
	for (var i = 0, len = this.children.length; i < len; i++) {
		this.children[i].dom.pindex = i;
	};
};

WebglNodeExe.prototype.setAttr = function WsetAttr (attr, value) {
	if (arguments.length === 2) {
		if (value === undefined || value === null) {
			delete this.attr[attr];
		} else {
			this.attr[attr] = value;
			this.dom.setAttr(attr, value);
		}
	} else if (arguments.length === 1 && typeof attr === 'object') {
		for (let key in attr) {
			if (attr[key] === undefined || attr[key] === null) {
				delete this.attr[key];
			} else {
				this.attr[key] = attr[key];
				this.dom.setAttr(key, attr[key]);
			}
		}
	}
	this.BBoxUpdate = true;
	queueInstance.vDomChanged(this.vDomIndex);
	return this;
};

WebglNodeExe.prototype.setStyle = function WsetStyle (attr, value) {
	if (arguments.length === 2) {
		if (attr === 'fill' || attr === 'stroke') {
			value = colorMap.colorToRGB(value);
		}
		this.style[attr] = value;
		this.dom.setStyle(attr, value);
	} else if (arguments.length === 1 && typeof attr === 'object') {
		for (let key in attr) {
			value = attr[key];

			if (key === 'fill' || key === 'stroke') {
				value = colorMap.colorToRGB(attr[key]);
			}
			this.style[key] = value;
			this.dom.setStyle(key, value);
		}
	}

	queueInstance.vDomChanged(this.vDomIndex);
	return this;
};

WebglNodeExe.prototype.setReIndex = function () {
	this.reindex = true;
};

WebglNodeExe.prototype.updateBBox = function CupdateBBox () {
	let status;

	if (this.bbox) {
		for (let i = 0, len = this.children.length; i < len; i += 1) {
			if (this.bbox && this.children[i]) {
				status = this.children[i].updateBBox() || status;
			}
		}
		if (this.BBoxUpdate || status) {
			this.dom.updateBBox(this.children);
			this.BBoxUpdate = false;
			return true;
		}
	}

	return false;
};

WebglNodeExe.prototype.in = function Cinfun (co) {
	return this.dom.in(co);
};

WebglNodeExe.prototype.on = function Con (eventType, hndlr) {
	let self = this;
	// this.dom.on(eventType, hndlr);
	if (!this.events) {
		this.events = {};
	}

	if (!hndlr && this.events[eventType]) {
		delete this.events[eventType];
	} else if (hndlr) {
		if (typeof hndlr === 'function') {
			const hnd = hndlr.bind(self);
			this.events[eventType] = function (event) {
				hnd(event);
			};
		} else if (typeof hndlr === 'object') {
			this.events[eventType] = hndlr;
			if (hndlr.constructor === zoomInstance.constructor || hndlr.constructor === dragInstance.constructor) {
				hndlr.bindMethods(this);
			}
		}
	}
	
	return this;
};

WebglNodeExe.prototype.execute = function Cexecute () {
	if (this.style.display === 'none') {
		return;
	}
	if (!this.dom.shader && this.dom instanceof WebglGroupNode) {
		for (let i = 0, len = this.children.length; i < len; i += 1) {
			this.children[i].execute();
		}
	} else if (this.dom.shader && this.dom instanceof WebglGroupNode) {
		if (this.reindex) {
			this.reIndexChildren();
			this.reindex = false;
		}
		if (this.exeCtx) {
			this.exeCtx(this.ctx);
		}
		this.dom.shader.execute(this.children);
	}
};

WebglNodeExe.prototype.child = function child (childrens) {
	const self = this;
	let node;
	if (self.dom instanceof WebglGroupNode) {
		for (let i = 0; i < childrens.length; i += 1) {
			node = childrens[i];
			node.dom.parent = self;
			self.children[self.children.length] = node;
			node.dom.pindex = self.children.length - 1;
			if (!(node instanceof RenderWebglShader)) {
				node.dom.setShader(this.dom.shader);
			}
		}
	} else {
		console.log('Error');
	}

	this.BBoxUpdate = true;
	queueInstance.vDomChanged(this.vDomIndex);
	return self;
};

WebglNodeExe.prototype.createEls = function CcreateEls (data, config) {
	const e = new WebglCollection({
		type: 'WEBGL',
		ctx: this.dom.ctx
	}, data, config, this.vDomIndex);
	this.child(e.stack);
	queueInstance.vDomChanged(this.vDomIndex);
	return e;
};

WebglNodeExe.prototype.createEl = function WcreateEl (config) {
	const e = new WebglNodeExe(this.ctx, config, domId(), this.vDomIndex);
	this.child([e]);
	queueInstance.vDomChanged(this.vDomIndex);
	return e;
};

WebglNodeExe.prototype.createShaderEl = function createShader (shaderObject) {
	const e = new RenderWebglShader(this.ctx, shaderObject, this.vDomIndex);
	this.child([e]);
	queueInstance.vDomChanged(this.vDomIndex);
	return e;
};

WebglNodeExe.prototype.remove = function Wremove () {
	const {
		children
	} = this.dom.parent;
	const index = children.indexOf(this);

	if (index !== -1) {
		if (this.dom.parent.dom.shader) {
			this.dom.parent.dom.shader.clear(this.dom.pindex);
			children[this.dom.pindex] = undefined;
			this.dom.parent.setReIndex();
		} else {
			children.splice(index, 1);
		}
	}

	this.BBoxUpdate = true;
	queueInstance.vDomChanged(this.vDomIndex);
};

WebglNodeExe.prototype.removeChild = function WremoveChild (obj) {
	let index = -1;
	this.children.forEach((d, i) => {
		if (d === obj) {
			index = i;
		}
	});

	if (index !== -1) {
		const removedNode = this.children.splice(index, 1)[0];
		this.dom.removeChild(removedNode.dom);
	}
	this.BBoxUpdate = true;
	queueInstance.vDomChanged(this.vDomIndex);
};

function webglLayer (container, contextConfig = {}, layerSettings = {}) {
	const res = container ? document.querySelector(container) : null;
	let height = res ? res.clientHeight : 0;
	let width = res ? res.clientWidth : 0;
	let clearColor = colorMap.rgba(0, 0, 0, 0);
	let { enableEvents = false, autoUpdate = true, enableResize = false } = layerSettings;

	contextConfig = contextConfig || {
		premultipliedAlpha: false,
		depth: false,
		antialias: false,
		alpha: true
	};
	const layer = document.createElement('canvas');
	const ctx = layer.getContext('webgl', contextConfig);

	const actualPixel = getPixlRatio(ctx);

	ratio = actualPixel >= 2 ? 2 : Math.floor(actualPixel);
	// ctx.enable(ctx.BLEND);
	// ctx.blendFunc(ctx.ONE, ctx.ONE_MINUS_SRC_ALPHA);
	// ctx.clearColor(clearColor.r, clearColor.g, clearColor.b, clearColor.a);
	layer.setAttribute('height', height * ratio);
	layer.setAttribute('width', width * ratio);
	layer.style.height = `${height}px`;
	layer.style.width = `${width}px`;
	layer.style.position = 'absolute';

	let vDomInstance;
	let vDomIndex = 999999;
	let cHeight;
	let cWidth;
	let resizeCall;
	let onChangeExe;

	if (res) {
		res.appendChild(layer);
		vDomInstance = new VDom();
		if (autoUpdate) {
			vDomIndex = queueInstance.addVdom(vDomInstance);
		}
	}
	
	const root = new WebglNodeExe(ctx, {
		el: 'group',
		attr: {
			id: 'rootNode'
		},
		ctx: function (ctx) {
			ctx.enable(ctx.BLEND);
			ctx.blendFunc(ctx.ONE, ctx.ONE_MINUS_SRC_ALPHA);
			ctx.clearColor(clearColor.r, clearColor.g, clearColor.b, clearColor.a);
		}
	}, domId(), vDomIndex);

	if (vDomInstance) {
		vDomInstance.rootNode(root);
	}
	const execute = root.execute.bind(root);
	root.container = res;
	root.domEl = layer;
	root.height = height;
	root.width = width;
	root.type = 'WEBGL';
	root.pixelRatio = ratio;

	let onClear = function (ctx) {
		ctx.viewport(0, 0, ctx.canvas.width, ctx.canvas.height);
		ctx.clear(ctx.COLOR_BUFFER_BIT | ctx.DEPTH_BUFFER_BIT);
	};

	root.execute = function () {
		onClear(this.ctx);
		this.updateBBox();
		execute();
	};

	root.update = function () {
		this.execute();
	};

	root.destroy = function () {
		let res = document.querySelector(container);
		if (res && res.contains(layer)) {
			res.removeChild(layer);
		}
		queueInstance.removeVdom(vDomIndex);
	};

	root.getPixels = function (x, y, width_, height_) {
		let pixels = new Uint8Array(width_ * height_ * 4);
		this.ctx.readPixels(x, y, width_, height_, this.ctx.RGBA, this.ctx.UNSIGNED_BYTE, pixels);
		return pixels;
	};

	root.putPixels = function (imageData, x, y) {
		return this.ctx.putImageData(imageData, x, y);
	};

	root.clear = function () {
		onClear(this.ctx);
	};

	root.setClearColor = function (color) {
		 clearColor = color;
	};

	root.setClear = function (exe) {
		 onClear = exe;
	};

	let resize = function () {
		if (!document.querySelector(container)) {
			window.removeEventListener('resize', resize);
			return;
		}
		height = cHeight || res.clientHeight;
		width = cWidth || res.clientWidth;
		layer.setAttribute('height', height * ratio);
		layer.setAttribute('width', width * ratio);
		root.width = width;
		root.height = height;

		onClear(root.ctx);

		if (resizeCall) {
			resizeCall();
		}

		root.execute();

		layer.style.height = `${height}px`;
		layer.style.width = `${width}px`;
	};

	root.onResize = function (exec) {
		resizeCall = exec;
	};

	root.onChange = function (exec) {
		onChangeExe = exec;
	};

	root.invokeOnChange = function () {
		if (onChangeExe) {
			onChangeExe();
		}
	};

	root.setSize = function (width_, height_) {
		this.domEl.setAttribute('height', height_ * ratio);
		this.domEl.setAttribute('width', width_ * ratio);
		this.domEl.style.height = `${height_}px`;
		this.domEl.style.width = `${width_}px`;
		this.width = width_;
		this.height = height_;
		height = height_;
		width = width_;
		this.execute();
	};

	root.setViewBox = function (x, y, height, width) {
	};

	root.setStyle = function (prop, value) {
		this.domEl.style[prop] = value;
	};

	root.setAttr = function (prop, value) {
		if (prop === 'viewBox') {
			this.setViewBox.apply(this, value.split(','));
		}
		layer.setAttribute(prop, value);
	};

	root.setContext = function (prop, value) {
		/** Expecting value to be array if multiple aruments */
		if (this.ctx[prop] && typeof this.ctx[prop] === 'function') {
			this.ctx[prop].apply(null, value);
		} else if (this.ctx[prop]) {
			this.ctx[prop] = value;
		}
	};

	root.MeshGeometry = function () {
		return new MeshGeometry(this.ctx);
	};

	root.PointsGeometry = function () {
		return new PointsGeometry(this.ctx);
	};

	root.LineGeometry = function () {
		return new LineGeometry(this.ctx);
	};

	root.TextureObject = function (config) {
		return new TextureObject(this.ctx, config, this.vDomIndex);
	};

	root.RenderTarget = function (config) {
		return new RenderTarget(this.ctx, config, this.vDomIndex);
	};

	if (enableEvents) {
		let eventsInstance = new Events(root);
		layer.addEventListener('mousemove', e => {
			// e.preventDefault();
			eventsInstance.mousemoveCheck(e);
		});
		// layer.addEventListener('click', e => {
		// 	e.preventDefault();
		// 	eventsInstance.clickCheck(e);
		// });
		// layer.addEventListener('dblclick', e => {
		// 	e.preventDefault();
		// 	eventsInstance.dblclickCheck(e);
		// });
		layer.addEventListener('mousedown', e => {
			// e.preventDefault();
			eventsInstance.mousedownCheck(e);
		});
		layer.addEventListener('mouseup', e => {
			// e.preventDefault();
			eventsInstance.mouseupCheck(e);
		});
		layer.addEventListener('mouseleave', e => {
			// e.preventDefault();
			eventsInstance.mouseleaveCheck(e);
		});
		layer.addEventListener('contextmenu', e => {
			// e.preventDefault();
			eventsInstance.contextmenuCheck(e);
		});
		layer.addEventListener('touchstart', e => {
			// e.preventDefault();
			eventsInstance.touchstartCheck(e);
		});
		layer.addEventListener('touchend', e => {
			// e.preventDefault();
			eventsInstance.touchendCheck(e);
		});
		layer.addEventListener('touchmove', e => {
			// e.preventDefault();
			eventsInstance.touchmoveCheck(e);
		});
		layer.addEventListener('touchcancel', e => {
			// e.preventDefault();
			eventsInstance.touchcancelCheck(e);
		});
		layer.addEventListener('wheel', e => {
			// e.preventDefault();
			eventsInstance.wheelEventCheck(e);
		});
		layer.addEventListener('pointerdown', e => {
			// console.log('pointerdown');
			eventsInstance.addPointer(e);
			eventsInstance.pointerdownCheck(e);
			// e.preventDefault();
		});
		layer.addEventListener('pointerup', e => {
			// console.log('pointerup');
			eventsInstance.removePointer(e);
			eventsInstance.pointerupCheck(e);
			// e.preventDefault();
		});
		layer.addEventListener('pointermove', e => {
			// e.preventDefault();
			eventsInstance.pointermoveCheck(e);
		});
	}

	queueInstance.execute();

	if (enableResize) {
		window.addEventListener('resize', resize);
	}

	return root;
}

function imageInstance (self) {
	let imageIns = new Image();
	imageIns.onload = function onload () {
		this.crossOrigin = 'anonymous';
		self.update();
		self.updated = true;
		queueInstance.vDomChanged(self.vDomIndex);
	};

	imageIns.onerror = function onerror (onerrorExe) {
		if (onerrorExe && typeof onerrorExe === 'function') {
			// onerrorExe.call(nodeExe)
		}
	};

	return imageIns;
}

function createEmptyArrayBuffer (width, height) {
	return new Uint8Array(new ArrayBuffer(width * height * 4));
}

function TextureObject (ctx, config, vDomIndex) {
	let self = this;
	let maxTextureSize = ctx.getParameter(ctx.MAX_TEXTURE_SIZE);
	this.ctx = ctx;
	this.texture = ctx.createTexture();
	this.type = 'TEXTURE_2D';
	this.width = config.width > maxTextureSize ? maxTextureSize : config.width; ;
	this.height = config.height > maxTextureSize ? maxTextureSize : config.height;
	this.border = config.border ? config.border : 0;
	this.format = config.format ? config.format : 'RGBA';
	this.type = config.type ? config.type : 'UNSIGNED_BYTE';
	// Math.pow(2, Math.ceil(Math.log(config.width) / Math.log(2)))
	// this.pixels = config.pixels ? config.pixels : null;
	this.warpS = config.warpS ? config.warpS : 'CLAMP_TO_EDGE';
	this.warpT = config.warpT ? config.warpT : 'CLAMP_TO_EDGE';
	this.magFilter = config.magFilter ? config.magFilter : 'LINEAR';
	this.minFilter = config.minFilter ? config.minFilter : 'LINEAR';
	this.mipMap = config.mipMap;
	this.updated = false;
	this.image = null;
	// this.image = new Image();
	this.vDomIndex = vDomIndex;

	if (typeof config.src === 'string') {
		self.image = imageInstance(self);
		self.image.src = config.src;
	} else if (config.src instanceof HTMLImageElement || config.src instanceof SVGImageElement || config.src instanceof HTMLCanvasElement || config.src instanceof Uint8Array) {
		self.image = config.src;
		self.update();
		self.updated = true;
	} else if (config.src instanceof NodePrototype) {
		self.image = config.src.domEl;
		self.update();
		self.updated = true;
	} else {
		if (this.width && this.height) {
			self.image = createEmptyArrayBuffer(this.width, this.height);
			self.update();
		}
		self.updated = true;
	}
	queueInstance.vDomChanged(self.vDomIndex);
};
TextureObject.prototype.setAttr = function (attr, value) {
	if (arguments.length === 1) {
		for (let key in attr) {
			this[key] = attr[key];
			if (key === 'src') {
				if (typeof value === 'string') {
					if (!this.image || !(this.image instanceof Image)) {
						this.image = imageInstance(this);
					}
					this.image.src = value;
				} else if (value instanceof HTMLImageElement || value instanceof SVGImageElement || value instanceof HTMLCanvasElement || value instanceof Uint8Array) {
					this.image = value;
					// this.update();
				} else if (value instanceof NodePrototype) {
					this.image = value.domEl;
					// this.update();
				}
			}
			if (attr['height'] || attr['width']) {
				self.image = createEmptyArrayBuffer(this.width, this.height);
			}
		}
	} else {
		this[attr] = value;
		console.warning('Instead of key, value, pass Object of key,value for optimal rendering');
		if (attr === 'src') {
			if (typeof value === 'string') {
				if (!this.image || !(this.image instanceof Image)) {
					this.image = imageInstance(this);
				}
				this.image.src = value;
			} else if (value instanceof HTMLImageElement || value instanceof SVGImageElement || value instanceof HTMLCanvasElement || value instanceof Uint8Array) {
				this.image = value;
				// this.update();
			} else if (value instanceof NodePrototype) {
				this.image = value.domEl;
				// this.update();
			}
		}
	}
	this.update();
};

TextureObject.prototype.loadTexture = function () {
	// this.ctx.activeTexture(this.ctx.TEXTURE0);
	this.ctx.bindTexture(this.ctx.TEXTURE_2D, this.texture);
};

TextureObject.prototype.clear = function (argument) {
	
};

TextureObject.prototype.update = function () {
	let ctx = this.ctx;

	ctx.bindTexture(ctx.TEXTURE_2D, this.texture);
	if (this.image && !(this.image instanceof Uint8Array)) {
		ctx.texImage2D(ctx.TEXTURE_2D, this.border, ctx[this.format], ctx[this.format], ctx[this.type], this.image);
	} else {
		ctx.texImage2D(ctx.TEXTURE_2D, this.border, ctx[this.format], this.width, this.height, 0, ctx[this.format], ctx[this.type], this.image);
		// ctx.texImage2D(ctx.TEXTURE_2D, this.border, ctx[this.format], ctx[this.format], ctx[this.type], new Uint8Array(this.width * this.height * 4));
		// ctx.texImage2D(ctx.TEXTURE_2D, this.border, ctx[this.format], this.width, this.height, 0, ctx[this.format], ctx[this.type], new Uint8Array(this.width * this.height * 4));
	}

	if (this.mipMap) {
		if (!isPowerOf2(self.image.width) || !isPowerOf2(self.image.height)) {
			console.warn('Image dimension not in power of 2');
		}
		ctx.generateMipmap(ctx.TEXTURE_2D);
		ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx[this.minFilter]);
		ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx[this.magFilter]);
	} else {
		ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx[this.warpS]);
		ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx[this.warpT]);
		ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx[this.minFilter]);
		ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx[this.minFilter]);
	}
	this.updated = true;
};

function RenderTarget (ctx, config) {
	this.ctx = ctx;
	this.fbo = ctx.createFramebuffer();
	this.texture = config.texture;
	if (!this.texture.updated) {
		this.texture.update();
	}
};

RenderTarget.prototype.setAttr = function (attr, value) {
	this[attr] = value;
};

RenderTarget.prototype.update = function () {
	if (!this.texture || !(this.texture instanceof TextureObject)) {
		return;
	}
	this.ctx.bindFramebuffer(this.ctx.FRAMEBUFFER, this.fbo);
	this.ctx.framebufferTexture2D(this.ctx.FRAMEBUFFER, this.ctx.COLOR_ATTACHMENT0, this.ctx.TEXTURE_2D, this.texture.texture, 0);
	this.ctx.clearColor(0, 0, 0, 0);
	this.ctx.clear(this.ctx.COLOR_BUFFER_BIT | this.ctx.DEPTH_BUFFER_BIT);
};

RenderTarget.prototype.clear = function () {
	this.ctx.bindFramebuffer(this.ctx.FRAMEBUFFER, null);
};

function WebGLGeometry () {
	// this.attributes = {};
	// this.indexes = null;
	// this.drawRange = [0, 0];
}
WebGLGeometry.prototype.setAttr = function (attr, value) {
	if (!value && this.attributes[attr]) {
		delete this.attributes[attr];
	} else {
		this.attributes[attr] = value;
	}
};
WebGLGeometry.prototype.setDrawRange = function (start, end) {
	this.drawRange = [start, end];
};
WebGLGeometry.prototype.setDrawType = function (type) {
	this.drawType = type;
};
WebGLGeometry.prototype.setIndex = function (obj) {
	this.indexes = obj;
};

function MeshGeometry (ctx) {
	this.attributes = {};
	this.drawType = 'TRIANGLES';
	this.indexes = null;
	this.drawRange = [0, 0];
};
MeshGeometry.prototype = new WebGLGeometry();
MeshGeometry.constructor = MeshGeometry;

function PointsGeometry (ctx) {
	this.attributes = {};
	this.drawType = 'POINTS';
	this.indexes = null;
	this.drawRange = [0, 0];
}

PointsGeometry.prototype = new WebGLGeometry();
PointsGeometry.constructor = PointsGeometry;

function LineGeometry (ctx) {
	this.attributes = {};
	this.drawType = 'LINES';
	this.indexes = null;
	this.drawRange = [0, 0];
};

LineGeometry.prototype = new WebGLGeometry();
LineGeometry.constructor = LineGeometry;

export default webglLayer;
