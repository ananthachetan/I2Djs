import queue from './queue.js';
import ease from './ease.js';

const queueInstance = queue;
const easing = ease;

let animeIdentifier = 0;

function animeId () {
	animeIdentifier += 1;
	return animeIdentifier;
}

function checkForTranslateBounds (trnsExt, [scaleX, scaleY], newTrns) {
	return newTrns[0] >= (trnsExt[0][0] * scaleX) && newTrns[0] <= (trnsExt[1][0] * scaleX) && newTrns[1] >= (trnsExt[0][1] * scaleY) && newTrns[1] <= (trnsExt[1][1] * scaleY);
}

function applyTranslate (event, { dx = 0, dy = 0 }, extent) {
	let translate = event.transform.translate;
	let [scaleX, scaleY = scaleX] = event.transform.scale;
	if (checkForTranslateBounds(extent, [scaleX, scaleY], [translate[0] + dx, translate[1] + dy])) {
		dx /= scaleX;
		dy /= scaleY;
		event.dx = dx;
		event.dy = dy;
		translate[0] /= scaleX;
		translate[1] /= scaleY;
		translate[0] += dx;
		translate[1] += dy;
		translate[0] *= scaleX;
		translate[1] *= scaleY;
	}
	return event;
}

let DragClass = function () {
	let self = this;
	this.dragStartFlag = false;
	this.dragExtent = [[-Infinity, -Infinity], [Infinity, Infinity]];
	this.event = {
		x: 0,
		y: 0,
		dx: 0,
		dy: 0,
		transform: {
			translate: [0, 0],
			scale: [1, 1]
		}
	};
	this.onDragStart = function (trgt, event) {
		self.event.x = event.offsetX;
		self.event.y = event.offsetY;
		self.event.dx = 0;
		self.event.dy = 0;
		self.dragStartFlag = true;
	};
	this.onDrag = function () {

	};
	this.onDragEnd = function () {
		self.event.x = event.offsetX;
		self.event.y = event.offsetY;
		self.event.dx = 0;
		self.event.dy = 0;
		self.dragStartFlag = false;
	};
};
DragClass.prototype = {
	dragExtent: function (ext) {
		this.dragExtent = ext;
		return this;
	},
	dragStart: function (fun) {
		let self = this;
		if (typeof fun === 'function') {
			this.onDragStart = function (trgt, event) {
				self.event.x = event.offsetX;
				self.event.y = event.offsetY;
				self.event.dx = 0;
				self.event.dy = 0;
				fun.call(trgt, self.event);
				self.dragStartFlag = true;
			};
		}
		return this;
	},
	drag: function (fun) {
		let self = this;
		if (typeof fun === 'function') {
			this.onDrag = function (trgt, event) {
				let dx = event.offsetX - self.event.x;
				let dy = event.offsetY - self.event.y;
				self.event.x = event.offsetX;
				self.event.y = event.offsetY;
				self.event = applyTranslate(this.event, { dx, dy }, self.dragExtent);
				fun.call(trgt, self.event);
			};
		}
		return this;
	},
	dragEnd: function (fun) {
		let self = this;
		if (typeof fun === 'function') {
			this.onDragEnd = function (trgt, event) {
				self.dragStartFlag = false;
				self.event.x = event.offsetX;
				self.event.y = event.offsetY;
				self.event.dx = 0;
				self.event.dy = 0;
				fun.call(trgt, self.event);
			};
		}
		return this;
	},
	execute: function (trgt, event, eventType) {
		let self = this;
		this.event.e = event;
		if ((event.type === 'touchstart' || event.type === 'touchmove') && event.touches && event.touches.length > 0) {
			event.offsetX = event.touches[0].clientX;
			event.offsetY = event.touches[0].clientY;
		} else if (event.type === 'touchend' || event.type === 'touchcancel') {
			event.offsetX = this.event.x;
			event.offsetY = this.event.y;
		}
		if (!this.dragStartFlag && eventType === 'mousedown') {
			self.onDragStart(trgt, event);
		} else if (this.onDragEnd && (eventType === 'mouseup' || eventType === 'mouseleave')) {
			self.onDragEnd(trgt, event);
		} else if (this.onDrag) {
			self.onDrag(trgt, event);
		}
	}
};

// let TouchClass = function () {
// 	let self = this;
// 	this.touchStartFlag = false;
// 	this.touchExtent = [[-Infinity, -Infinity], [Infinity, Infinity]];
// 	this.event = {
// 		x: 0,
// 		y: 0,
// 		dx: 0,
// 		dy: 0,
// 		transform: {
// 			translate: [0, 0],
// 			scale: [1, 1]
// 		}
// 	};
// 	this.onTouchStart = function (trgt, event) {
// 		self.event.x = event.offsetX;
// 		self.event.y = event.offsetY;
// 		self.event.dx = 0;
// 		self.event.dy = 0;
// 		self.touchStartFlag = true;
// 	};
// 	this.onTouch = function () {

// 	};
// 	this.onTouchEnd = function () {
// 		self.event.x = event.offsetX;
// 		self.event.y = event.offsetY;
// 		self.event.dx = 0;
// 		self.event.dy = 0;
// 		self.touchStartFlag = false;
// 	};
// };
// TouchClass.prototype = {
// 	touchStart: function (fun) {
// 		if (typeof fun === 'function') {
// 			this.onTouchStart = fun;
// 		}
// 		return this;
// 	},
// 	touch: function (fun) {
// 		if (typeof fun === 'function') {
// 			this.onTouch = fun;
// 		}
// 		return this;
// 	},
// 	touchEnd: function (fun) {
// 		if (typeof fun === 'function') {
// 			this.onTouchEnd = fun;
// 		}
// 		return this;
// 	},
// 	execute: function (trgt, event, eventType) {
// 		let self = this;
// 		this.event.e = event;
// 		if (!this.dragStartFlag && eventType === 'mousedown') {
// 			self.onDragStart(trgt, event);
// 		} else if (this.onDragEnd && (eventType === 'mouseup' || eventType === 'mouseleave')) {
// 			self.onDragEnd(trgt, event);
// 		} else if (this.onDrag) {
// 			self.onDrag(trgt, event);
// 		}
// 	}
// };


function scaleRangeCheck (range, scale) {
	if (scale <= range[0]) {
		return range[0];
	} else if (scale >= range[1]) {
		return range[1];
	}
	return scale;
}

function computeTransform (transformObj, oScale, nScale, point) {
	transformObj.translate[0] /= oScale;
	transformObj.translate[1] /= oScale;
	transformObj.translate[0] -= ((point[0] / oScale) - (point[0] / nScale));
	transformObj.translate[1] -= ((point[1] / oScale) - (point[1] / nScale));
	transformObj.scale = [nScale, nScale];
	transformObj.translate[0] *= nScale;
	transformObj.translate[1] *= nScale;

	return transformObj;
}


let ZoomClass = function () {
	let self = this;
	this.event = {
		x: 0,
		y: 0,
		dx: 0,
		dy: 0
	};
	this.event.transform = {
		translate: [0, 0],
		scale: [1, 1]
	};
	this.zoomBy_ = 0.001;
	this.zoomExtent_ = [0, Infinity];
	this.zoomStartFlag = false;
	this.zoomDuration = 250;
	this.onZoomStart = function (trgt, event) {
		self.event.x = event.offsetX;
		self.event.y = event.offsetY;
		self.event.dx = 0;
		self.event.dy = 0;
		self.zoomStartFlag = true;
	};
	this.onZoom = function (trgt, event) {
		self.event.x = event.offsetX;
		self.event.y = event.offsetY;
	};
	this.onZoomEnd = function (trgt, event) {
		self.event.x = event.offsetX;
		self.event.y = event.offsetY;
		self.event.dx = 0;
		self.event.dy = 0;
		self.zoomStartFlag = false;
	};
	this.onPanStart = function (trgt, event) {
	};
	this.onPan = function (trgt, event) {
	};
	this.onPanEnd = function () {
	};
	this.disableWheel = false;
	this.disableDbclick = false;
};

ZoomClass.prototype.zoomStart = function (fun) {
	let self = this;
	if (typeof fun === 'function') {
		this.zoomStartExe = fun;
		this.onZoomStart = function (trgt, event) {
			self.event.x = event.offsetX;
			self.event.y = event.offsetY;
			self.event.dx = 0;
			self.event.dy = 0;
			if (!self.zoomStartFlag) {
				fun.call(trgt, self.event);
			}
			self.zoomStartFlag = true;
		};
	}
	return this;
};

ZoomClass.prototype.zoom = function (fun) {
	let self = this;
	if (typeof fun === 'function') {
		this.zoomExe = fun;
		this.onZoom = function (trgt, event) {
			let transform = self.event.transform;
			let origScale = transform.scale[0];
			let newScale = origScale;
			let deltaY = event.deltaY;
			let x = event.offsetX;
			let y = event.offsetY;

			newScale = scaleRangeCheck(self.zoomExtent_, newScale + (deltaY * -1 * self.zoomBy_));
		
			self.event.transform = computeTransform(transform, origScale, newScale, [x, y]);
			self.event.x = x;
			self.event.y = y;
			fun.call(trgt, self.event);
		};
	}
	return this;
};

ZoomClass.prototype.zoomEnd = function (fun) {
	let self = this;
	if (typeof fun === 'function') {
		this.zoomEndExe = fun;
		this.onZoomEnd = function (trgt, event) {
			self.event.x = event.offsetX;
			self.event.y = event.offsetY;
			self.event.dx = 0;
			self.event.dy = 0;
			self.zoomStartFlag = false;
			fun.call(trgt, self.event);
			event.preventDefault();
		};
	}
	return this;
};

ZoomClass.prototype.scaleBy = function scaleBy (trgt, k, point) {
	let self = this;
	let transform = self.event.transform;
	let newScale = k * transform.scale[0];
	let origScale = transform.scale[0];
	let zoomTrgt = this.zoomTarget_ || point;
	let xdiff = (zoomTrgt[0] - point[0]) * origScale;
	let ydiff = (zoomTrgt[1] - point[1]) * origScale;
	let pf = 0;

	let targetConfig = {
		run (f) {
			let oScale = transform.scale[0];
			let nscale = scaleRangeCheck(self.zoomExtent_, origScale + ((newScale - origScale) * f));

			self.event.transform = computeTransform(transform, oScale, nscale, point);
			self.event.transform.translate[0] += (xdiff * (f - pf)) / nscale;
			self.event.transform.translate[1] += (ydiff * (f - pf)) / nscale;

			pf = f;

			if (self.zoomExe) {
				self.zoomExe.call(trgt, self.event);
			}
		},
		target: trgt,
		duration: 250,
		delay: 0,
		end: function () {
			if (self.onZoomEnd) {
				self.onZoomEnd(trgt, {});
			}
		},
		loop: 1,
		direction: 'default',
		ease: 'default'
	};
	queueInstance.add(animeId(), targetConfig, easing(targetConfig.ease));
};

ZoomClass.prototype.zoomTarget = function zoomTarget (point) {
	this.zoomTarget_ = point;
};

ZoomClass.prototype.scaleTo = function scaleTo (trgt, newScale, point) {
	let self = this;
	let transform = self.event.transform;
	let origScale = transform.scale[0];
	let zoomTrgt = this.zoomTarget_ || point;
	let xdiff = (zoomTrgt[0] - point[0]) * origScale;
	let ydiff = (zoomTrgt[1] - point[1]) * origScale;
	let pf = 0;
	let targetConfig = {
		run (f) {
			let oScale = transform.scale[0];
			let nscale = scaleRangeCheck(self.zoomExtent_, origScale + ((newScale - origScale) * f));

			self.event.transform = computeTransform(transform, oScale, nscale, point);
			self.event.transform.translate[0] += (xdiff * (f - pf)) / nscale;
			self.event.transform.translate[1] += (ydiff * (f - pf)) / nscale;

			pf = f;

			if (!self.zoomStartFlag) {
				self.onZoomStart(trgt, {
					offsetX: point[0],
					offsetY: point[1]
				});
			}

			if (self.zoomExe) {
				self.zoomExe.call(trgt, self.event);
			}
		},
		target: trgt,
		duration: 250,
		delay: 0,
		end: function () {
			if (self.onZoomEnd) {
				self.onZoomEnd(trgt, self.event);
			}
		},
		loop: 1,
		direction: 'default',
		ease: 'default'
	};
	queueInstance.add(animeId(), targetConfig, easing(targetConfig.ease));
};

ZoomClass.prototype.panTo = function panTo (trgt, point) {
	let self = this;
	let transform = self.event.transform;
	let xdiff = point[0] - self.event.x;
	let ydiff = point[1] - self.event.y;
	let pf = 0;
	let targetConfig = {
		run (f) {
			let [scale] = transform.scale;

			transform.translate[0] += (xdiff * (f - pf)) / scale;
			transform.translate[1] += (ydiff * (f - pf)) / scale;

			pf = f;

			if (self.zoomExe) {
				self.zoomExe.call(trgt, self.event);
			}
		},
		target: trgt,
		duration: 250,
		delay: 0,
		end: function () {
			if (self.onZoomEnd) {
				self.onZoomEnd(trgt, self.event);
			}
		},
		loop: 1,
		direction: 'default',
		ease: 'default'
	};
	queueInstance.add(animeId(), targetConfig, easing(targetConfig.ease));
};

ZoomClass.prototype.bindMethods = function (trgt) {
	let self = this;
	trgt.scaleTo = function (k, point) {
		self.scaleTo(trgt, k, point);
	};
	trgt.scaleBy = function (k, point) {
		self.scaleBy(trgt, k, point);
		return trgt;
	};
	trgt.panTo = function (srcPoint, point) {
		self.panTo(trgt, srcPoint, point);
		return trgt;
	};
};

ZoomClass.prototype.zoomFactor = function (factor) {
	this.zoomBy_ = factor;
	return this;
};

ZoomClass.prototype.scaleExtent = function (range) {
	this.zoomExtent_ = range;
	return this;
};
ZoomClass.prototype.duration = function (time) {
	this.zoomDuration = time || 250;
	return this;
};

ZoomClass.prototype.panExtent = function (range) {
	// range to be [[x1, y1], [x2, y2]];
	this.panExtent_ = range;
	this.panFlag = true;
	return this;
};

ZoomClass.prototype.zoomTransition = function () {

};

ZoomClass.prototype.zoomExecute = function (trgt, event) {
	this.eventType = 'zoom';
	if (!this.zoomStartFlag) {
		this.onZoomStart(trgt, event);
	} else if (this.onZoom) {
		this.onZoom(trgt, event);
	}
	event.preventDefault();
};

ZoomClass.prototype.panExecute = function (trgt, event, eventType) {
	this.event.e = event;
	this.eventType = 'pan';
	if (event.type === 'touchstart' || event.type === 'touchmove' || event.type === 'touchend' || event.type === 'touchcancel') {
		event.offsetX = event.touches[0].clientX;
		event.offsetY = event.touches[0].clientY;
	}
	if (!this.zoomStartFlag && eventType === 'mousedown') {
		this.onZoomStart(trgt, event);
	} else if (this.onZoomEnd && (eventType === 'mouseup' || eventType === 'mouseleave')) {
		this.onZoomEnd(trgt, event);
	} else if (this.zoomExe) {
		let dx = event.offsetX - this.event.x;
		let dy = event.offsetY - this.event.y;

		this.event.x = event.offsetX;
		this.event.y = event.offsetY;

		this.event = applyTranslate(this.event, { dx, dy }, this.panExtent_);
		this.zoomExe.call(trgt, this.event);
	}
};
	
export default {
	drag: function () {
		return new DragClass();
	},
	zoom: function () {
		return new ZoomClass();
	}
};
