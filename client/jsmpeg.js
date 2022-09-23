var JSMpeg = {
  Player: null,
  VideoElement: null,
  BitBuffer: null,
  Source: {},
  Demuxer: {},
  Decoder: {},
  Renderer: {},
  AudioOutput: {},
  Now: function () {
    return window.performance
      ? window.performance.now() / 1e3
      : Date.now() / 1e3;
  },
  CreateVideoElements: function () {
    var elements = document.querySelectorAll(".jsmpeg");
    for (var i = 0; i < elements.length; i++) {
      new JSMpeg.VideoElement(elements[i]);
    }
  },
  Fill: function (array, value) {
    if (array.fill) {
      array.fill(value);
    } else {
      for (var i = 0; i < array.length; i++) {
        array[i] = value;
      }
    }
  },
  Base64ToArrayBuffer: function (base64) {
    var binary = window.atob(base64);
    var length = binary.length;
    var bytes = new Uint8Array(length);
    for (var i = 0; i < length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  },
  WASM_BINARY_INLINED: null,
};
if (document.readyState === "complete") {
  JSMpeg.CreateVideoElements();
} else {
  document.addEventListener("DOMContentLoaded", JSMpeg.CreateVideoElements);
}
JSMpeg.VideoElement = (function () {
  "use strict";
  var VideoElement = function (element) {
    var url = element.dataset.url;
    if (!url) {
      throw "VideoElement has no `data-url` attribute";
    }
    var addStyles = function (element, styles) {
      for (var name in styles) {
        element.style[name] = styles[name];
      }
    };
    this.container = element;
    addStyles(this.container, {
      display: "inline-block",
      position: "relative",
      minWidth: "80px",
      minHeight: "80px",
    });
    this.canvas = document.createElement("canvas");
    this.canvas.width = 960;
    this.canvas.height = 540;
    addStyles(this.canvas, { display: "block", width: "100%" });
    this.container.appendChild(this.canvas);
    this.playButton = document.createElement("div");
    this.playButton.innerHTML = VideoElement.PLAY_BUTTON;
    addStyles(this.playButton, {
      zIndex: 2,
      position: "absolute",
      top: "0",
      bottom: "0",
      left: "0",
      right: "0",
      maxWidth: "75px",
      maxHeight: "75px",
      margin: "auto",
      opacity: "0.7",
      cursor: "pointer",
    });
    this.container.appendChild(this.playButton);
    var options = { canvas: this.canvas };
    for (var option in element.dataset) {
      try {
        options[option] = JSON.parse(element.dataset[option]);
      } catch (err) {
        options[option] = element.dataset[option];
      }
    }
    this.player = new JSMpeg.Player(url, options);
    element.playerInstance = this.player;
    if (options.poster && !options.autoplay && !this.player.options.streaming) {
      options.decodeFirstFrame = false;
      this.poster = new Image();
      this.poster.src = options.poster;
      this.poster.addEventListener("load", this.posterLoaded);
      addStyles(this.poster, {
        display: "block",
        zIndex: 1,
        position: "absolute",
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
      });
      this.container.appendChild(this.poster);
    }
    if (!this.player.options.streaming) {
      this.container.addEventListener("click", this.onClick.bind(this));
    }
    if (options.autoplay || this.player.options.streaming) {
      this.playButton.style.display = "none";
    }
    if (this.player.audioOut && !this.player.audioOut.unlocked) {
      var unlockAudioElement = this.container;
      if (options.autoplay || this.player.options.streaming) {
        this.unmuteButton = document.createElement("div");
        this.unmuteButton.innerHTML = VideoElement.UNMUTE_BUTTON;
        addStyles(this.unmuteButton, {
          zIndex: 2,
          position: "absolute",
          bottom: "10px",
          right: "20px",
          width: "75px",
          height: "75px",
          margin: "auto",
          opacity: "0.7",
          cursor: "pointer",
        });
        this.container.appendChild(this.unmuteButton);
        unlockAudioElement = this.unmuteButton;
      }
      this.unlockAudioBound = this.onUnlockAudio.bind(this, unlockAudioElement);
      unlockAudioElement.addEventListener(
        "touchstart",
        this.unlockAudioBound,
        false
      );
      unlockAudioElement.addEventListener("click", this.unlockAudioBound, true);
    }
  };
  VideoElement.prototype.onUnlockAudio = function (element, ev) {
    if (this.unmuteButton) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    this.player.audioOut.unlock(
      function () {
        if (this.unmuteButton) {
          this.unmuteButton.style.display = "none";
        }
        element.removeEventListener("touchstart", this.unlockAudioBound);
        element.removeEventListener("click", this.unlockAudioBound);
      }.bind(this)
    );
  };
  VideoElement.prototype.onClick = function (ev) {
    if (this.player.isPlaying) {
      this.player.pause();
      this.playButton.style.display = "block";
    } else {
      this.player.play();
      this.playButton.style.display = "none";
      if (this.poster) {
        this.poster.style.display = "none";
      }
    }
  };
  VideoElement.PLAY_BUTTON =
    '<svg style="max-width: 75px; max-height: 75px;" ' +
    'viewBox="0 0 200 200" alt="Play video">' +
    '<circle cx="100" cy="100" r="90" fill="none" ' +
    'stroke-width="15" stroke="#fff"/>' +
    '<polygon points="70, 55 70, 145 145, 100" fill="#fff"/>' +
    "</svg>";
  VideoElement.UNMUTE_BUTTON =
    '<svg style="max-width: 75px; max-height: 75px;" viewBox="0 0 75 75">' +
    '<polygon class="audio-speaker" stroke="none" fill="#fff" ' +
    'points="39,13 22,28 6,28 6,47 21,47 39,62 39,13"/>' +
    '<g stroke="#fff" stroke-width="5">' +
    '<path d="M 49,50 69,26"/>' +
    '<path d="M 69,50 49,26"/>' +
    "</g>" +
    "</svg>";
  return VideoElement;
})();
JSMpeg.Player = (function () {
  "use strict";
  var Player = function (url, options) {
    this.options = options || {};
    if (options.source) {
      this.source = new options.source(url, options);
      options.streaming = !!this.source.streaming;
    } else if (url.match(/^wss?:\/\//)) {
      this.source = new JSMpeg.Source.WebSocket(url, options);
      options.streaming = true;
    } else if (options.progressive !== false) {
      this.source = new JSMpeg.Source.AjaxProgressive(url, options);
      options.streaming = false;
    } else {
      this.source = new JSMpeg.Source.Ajax(url, options);
      options.streaming = false;
    }
    this.maxAudioLag = options.maxAudioLag || 0.25;
    this.loop = options.loop !== false;
    this.autoplay = !!options.autoplay || options.streaming;
    this.demuxer = new JSMpeg.Demuxer.TS(options);
    this.source.connect(this.demuxer);
    if (!options.disableWebAssembly && JSMpeg.WASMModule.IsSupported()) {
      this.wasmModule = JSMpeg.WASMModule.GetModule();
      options.wasmModule = this.wasmModule;
    }
    if (options.video !== false) {
      this.video = options.wasmModule
        ? new JSMpeg.Decoder.MPEG1VideoWASM(options)
        : new JSMpeg.Decoder.MPEG1Video(options);
      this.renderer =
        !options.disableGl && JSMpeg.Renderer.WebGL.IsSupported()
          ? new JSMpeg.Renderer.WebGL(options)
          : new JSMpeg.Renderer.Canvas2D(options);
      this.demuxer.connect(JSMpeg.Demuxer.TS.STREAM.VIDEO_1, this.video);
      this.video.connect(this.renderer);
    }
    if (options.audio !== false && JSMpeg.AudioOutput.WebAudio.IsSupported()) {
      this.audio = options.wasmModule
        ? new JSMpeg.Decoder.MP2AudioWASM(options)
        : new JSMpeg.Decoder.MP2Audio(options);
      this.audioOut = new JSMpeg.AudioOutput.WebAudio(options);
      this.demuxer.connect(JSMpeg.Demuxer.TS.STREAM.AUDIO_1, this.audio);
      this.audio.connect(this.audioOut);
    }
    Object.defineProperty(this, "currentTime", {
      get: this.getCurrentTime,
      set: this.setCurrentTime,
    });
    Object.defineProperty(this, "volume", {
      get: this.getVolume,
      set: this.setVolume,
    });
    this.paused = true;
    this.unpauseOnShow = false;
    if (options.pauseWhenHidden !== false) {
      document.addEventListener("visibilitychange", this.showHide.bind(this));
    }
    if (this.wasmModule) {
      if (this.wasmModule.ready) {
        this.startLoading();
      } else if (JSMpeg.WASM_BINARY_INLINED) {
        var wasm = JSMpeg.Base64ToArrayBuffer(JSMpeg.WASM_BINARY_INLINED);
        this.wasmModule.loadFromBuffer(wasm, this.startLoading.bind(this));
      } else {
        this.wasmModule.loadFromFile(
          "jsmpeg.wasm",
          this.startLoading.bind(this)
        );
      }
    } else {
      this.startLoading();
    }
  };
  Player.prototype.startLoading = function () {
    this.source.start();
    if (this.autoplay) {
      this.play();
    }
  };
  Player.prototype.showHide = function (ev) {
    if (document.visibilityState === "hidden") {
      this.unpauseOnShow = this.wantsToPlay;
      this.pause();
    } else if (this.unpauseOnShow) {
      this.play();
    }
  };
  Player.prototype.play = function (ev) {
    if (this.animationId) {
      return;
    }
    this.animationId = requestAnimationFrame(this.update.bind(this));
    this.wantsToPlay = true;
    this.paused = false;
  };
  Player.prototype.pause = function (ev) {
    if (this.paused) {
      return;
    }
    cancelAnimationFrame(this.animationId);
    this.animationId = null;
    this.wantsToPlay = false;
    this.isPlaying = false;
    this.paused = true;
    if (this.audio && this.audio.canPlay) {
      this.audioOut.stop();
      this.seek(this.currentTime);
    }
    if (this.options.onPause) {
      this.options.onPause(this);
    }
  };
  Player.prototype.getVolume = function () {
    return this.audioOut ? this.audioOut.volume : 0;
  };
  Player.prototype.setVolume = function (volume) {
    if (this.audioOut) {
      this.audioOut.volume = volume;
    }
  };
  Player.prototype.stop = function (ev) {
    this.pause();
    this.seek(0);
    if (this.video && this.options.decodeFirstFrame !== false) {
      this.video.decode();
    }
  };
  Player.prototype.destroy = function () {
    this.pause();
    this.source.destroy();
    this.video && this.video.destroy();
    this.renderer && this.renderer.destroy();
    this.audio && this.audio.destroy();
    this.audioOut && this.audioOut.destroy();
  };
  Player.prototype.seek = function (time) {
    var startOffset =
      this.audio && this.audio.canPlay
        ? this.audio.startTime
        : this.video.startTime;
    if (this.video) {
      this.video.seek(time + startOffset);
    }
    if (this.audio) {
      this.audio.seek(time + startOffset);
    }
    this.startTime = JSMpeg.Now() - time;
  };
  Player.prototype.getCurrentTime = function () {
    return this.audio && this.audio.canPlay
      ? this.audio.currentTime - this.audio.startTime
      : this.video.currentTime - this.video.startTime;
  };
  Player.prototype.setCurrentTime = function (time) {
    this.seek(time);
  };
  Player.prototype.update = function () {
    this.animationId = requestAnimationFrame(this.update.bind(this));
    if (!this.source.established) {
      if (this.renderer) {
        this.renderer.renderProgress(this.source.progress);
      }
      return;
    }
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.startTime = JSMpeg.Now() - this.currentTime;
      if (this.options.onPlay) {
        this.options.onPlay(this);
      }
    }
    if (this.options.streaming) {
      this.updateForStreaming();
    } else {
      this.updateForStaticFile();
    }
  };
  Player.prototype.updateForStreaming = function () {
    if (this.video) {
      this.video.decode();
    }
    if (this.audio) {
      var decoded = false;
      do {
        if (this.audioOut.enqueuedTime > this.maxAudioLag) {
          this.audioOut.resetEnqueuedTime();
          this.audioOut.enabled = false;
        }
        decoded = this.audio.decode();
      } while (decoded);
      this.audioOut.enabled = true;
    }
  };
  Player.prototype.nextFrame = function () {
    if (this.source.established && this.video) {
      return this.video.decode();
    }
    return false;
  };
  Player.prototype.updateForStaticFile = function () {
    var notEnoughData = false,
      headroom = 0;
    if (this.audio && this.audio.canPlay) {
      while (
        !notEnoughData &&
        this.audio.decodedTime - this.audio.currentTime < 0.25
      ) {
        notEnoughData = !this.audio.decode();
      }
      if (this.video && this.video.currentTime < this.audio.currentTime) {
        notEnoughData = !this.video.decode();
      }
      headroom = this.demuxer.currentTime - this.audio.currentTime;
    } else if (this.video) {
      var targetTime = JSMpeg.Now() - this.startTime + this.video.startTime,
        lateTime = targetTime - this.video.currentTime,
        frameTime = 1 / this.video.frameRate;
      if (this.video && lateTime > 0) {
        if (lateTime > frameTime * 2) {
          this.startTime += lateTime;
        }
        notEnoughData = !this.video.decode();
      }
      headroom = this.demuxer.currentTime - targetTime;
    }
    this.source.resume(headroom);
    if (notEnoughData && this.source.completed) {
      if (this.loop) {
        this.seek(0);
      } else {
        this.pause();
        if (this.options.onEnded) {
          this.options.onEnded(this);
        }
      }
    } else if (notEnoughData && this.options.onStalled) {
      this.options.onStalled(this);
    }
  };
  return Player;
})();
JSMpeg.BitBuffer = (function () {
  "use strict";
  var BitBuffer = function (bufferOrLength, mode) {
    if (typeof bufferOrLength === "object") {
      this.bytes =
        bufferOrLength instanceof Uint8Array
          ? bufferOrLength
          : new Uint8Array(bufferOrLength);
      this.byteLength = this.bytes.length;
    } else {
      this.bytes = new Uint8Array(bufferOrLength || 1024 * 1024);
      this.byteLength = 0;
    }
    this.mode = mode || BitBuffer.MODE.EXPAND;
    this.index = 0;
  };
  BitBuffer.prototype.resize = function (size) {
    var newBytes = new Uint8Array(size);
    if (this.byteLength !== 0) {
      this.byteLength = Math.min(this.byteLength, size);
      newBytes.set(this.bytes, 0, this.byteLength);
    }
    this.bytes = newBytes;
    this.index = Math.min(this.index, this.byteLength << 3);
  };
  BitBuffer.prototype.evict = function (sizeNeeded) {
    var bytePos = this.index >> 3,
      available = this.bytes.length - this.byteLength;
    if (
      this.index === this.byteLength << 3 ||
      sizeNeeded > available + bytePos
    ) {
      this.byteLength = 0;
      this.index = 0;
      return;
    } else if (bytePos === 0) {
      return;
    }
    if (this.bytes.copyWithin) {
      this.bytes.copyWithin(0, bytePos, this.byteLength);
    } else {
      this.bytes.set(this.bytes.subarray(bytePos, this.byteLength));
    }
    this.byteLength = this.byteLength - bytePos;
    this.index -= bytePos << 3;
    return;
  };
  BitBuffer.prototype.write = function (buffers) {
    var isArrayOfBuffers = typeof buffers[0] === "object",
      totalLength = 0,
      available = this.bytes.length - this.byteLength;
    if (isArrayOfBuffers) {
      var totalLength = 0;
      for (var i = 0; i < buffers.length; i++) {
        totalLength += buffers[i].byteLength;
      }
    } else {
      totalLength = buffers.byteLength;
    }
    if (totalLength > available) {
      if (this.mode === BitBuffer.MODE.EXPAND) {
        var newSize = Math.max(this.bytes.length * 2, totalLength - available);
        this.resize(newSize);
      } else {
        this.evict(totalLength);
      }
    }
    if (isArrayOfBuffers) {
      for (var i = 0; i < buffers.length; i++) {
        this.appendSingleBuffer(buffers[i]);
      }
    } else {
      this.appendSingleBuffer(buffers);
    }
    return totalLength;
  };
  BitBuffer.prototype.appendSingleBuffer = function (buffer) {
    buffer = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.bytes.set(buffer, this.byteLength);
    this.byteLength += buffer.length;
  };
  BitBuffer.prototype.findNextStartCode = function () {
    for (var i = (this.index + 7) >> 3; i < this.byteLength; i++) {
      if (
        this.bytes[i] == 0 &&
        this.bytes[i + 1] == 0 &&
        this.bytes[i + 2] == 1
      ) {
        this.index = (i + 4) << 3;
        return this.bytes[i + 3];
      }
    }
    this.index = this.byteLength << 3;
    return -1;
  };
  BitBuffer.prototype.findStartCode = function (code) {
    var current = 0;
    while (true) {
      current = this.findNextStartCode();
      if (current === code || current === -1) {
        return current;
      }
    }
    return -1;
  };
  BitBuffer.prototype.nextBytesAreStartCode = function () {
    var i = (this.index + 7) >> 3;
    return (
      i >= this.byteLength ||
      (this.bytes[i] == 0 && this.bytes[i + 1] == 0 && this.bytes[i + 2] == 1)
    );
  };
  BitBuffer.prototype.peek = function (count) {
    var offset = this.index;
    var value = 0;
    while (count) {
      var currentByte = this.bytes[offset >> 3],
        remaining = 8 - (offset & 7),
        read = remaining < count ? remaining : count,
        shift = remaining - read,
        mask = 255 >> (8 - read);
      value = (value << read) | ((currentByte & (mask << shift)) >> shift);
      offset += read;
      count -= read;
    }
    return value;
  };
  BitBuffer.prototype.read = function (count) {
    var value = this.peek(count);
    this.index += count;
    return value;
  };
  BitBuffer.prototype.skip = function (count) {
    return (this.index += count);
  };
  BitBuffer.prototype.rewind = function (count) {
    this.index = Math.max(this.index - count, 0);
  };
  BitBuffer.prototype.has = function (count) {
    return (this.byteLength << 3) - this.index >= count;
  };
  BitBuffer.MODE = { EVICT: 1, EXPAND: 2 };
  return BitBuffer;
})();
JSMpeg.Source.Ajax = (function () {
  "use strict";
  var AjaxSource = function (url, options) {
    this.url = url;
    this.destination = null;
    this.request = null;
    this.streaming = false;
    this.completed = false;
    this.established = false;
    this.progress = 0;
    this.onEstablishedCallback = options.onSourceEstablished;
    this.onCompletedCallback = options.onSourceCompleted;
  };
  AjaxSource.prototype.connect = function (destination) {
    this.destination = destination;
  };
  AjaxSource.prototype.start = function () {
    this.request = new XMLHttpRequest();
    this.request.onreadystatechange = function () {
      if (
        this.request.readyState === this.request.DONE &&
        this.request.status === 200
      ) {
        this.onLoad(this.request.response);
      }
    }.bind(this);
    this.request.onprogress = this.onProgress.bind(this);
    this.request.open("GET", this.url);
    this.request.responseType = "arraybuffer";
    this.request.send();
  };
  AjaxSource.prototype.resume = function (secondsHeadroom) {};
  AjaxSource.prototype.destroy = function () {
    this.request.abort();
  };
  AjaxSource.prototype.onProgress = function (ev) {
    this.progress = ev.loaded / ev.total;
  };
  AjaxSource.prototype.onLoad = function (data) {
    this.established = true;
    this.completed = true;
    this.progress = 1;
    if (this.onEstablishedCallback) {
      this.onEstablishedCallback(this);
    }
    if (this.onCompletedCallback) {
      this.onCompletedCallback(this);
    }
    if (this.destination) {
      this.destination.write(data);
    }
  };
  return AjaxSource;
})();
JSMpeg.Source.Fetch = (function () {
  "use strict";
  var FetchSource = function (url, options) {
    this.url = url;
    this.destination = null;
    this.request = null;
    this.streaming = true;
    this.completed = false;
    this.established = false;
    this.progress = 0;
    this.aborted = false;
    this.onEstablishedCallback = options.onSourceEstablished;
    this.onCompletedCallback = options.onSourceCompleted;
  };
  FetchSource.prototype.connect = function (destination) {
    this.destination = destination;
  };
  FetchSource.prototype.start = function () {
    var params = { method: "GET", headers: new Headers(), cache: "default" };
    self
      .fetch(this.url, params)
      .then(
        function (res) {
          if (res.ok && res.status >= 200 && res.status <= 299) {
            this.progress = 1;
            this.established = true;
            return this.pump(res.body.getReader());
          } else {
          }
        }.bind(this)
      )
      .catch(function (err) {
        throw err;
      });
  };
  FetchSource.prototype.pump = function (reader) {
    return reader
      .read()
      .then(
        function (result) {
          if (result.done) {
            this.completed = true;
          } else {
            if (this.aborted) {
              return reader.cancel();
            }
            if (this.destination) {
              this.destination.write(result.value.buffer);
            }
            return this.pump(reader);
          }
        }.bind(this)
      )
      .catch(function (err) {
        throw err;
      });
  };
  FetchSource.prototype.resume = function (secondsHeadroom) {};
  FetchSource.prototype.abort = function () {
    this.aborted = true;
  };
  return FetchSource;
})();
JSMpeg.Source.AjaxProgressive = (function () {
  "use strict";
  var AjaxProgressiveSource = function (url, options) {
    this.url = url;
    this.destination = null;
    this.request = null;
    this.streaming = false;
    this.completed = false;
    this.established = false;
    this.progress = 0;
    this.fileSize = 0;
    this.loadedSize = 0;
    this.chunkSize = options.chunkSize || 1024 * 1024;
    this.isLoading = false;
    this.loadStartTime = 0;
    this.throttled = options.throttled !== false;
    this.aborted = false;
    this.onEstablishedCallback = options.onSourceEstablished;
    this.onCompletedCallback = options.onSourceCompleted;
  };
  AjaxProgressiveSource.prototype.connect = function (destination) {
    this.destination = destination;
  };
  AjaxProgressiveSource.prototype.start = function () {
    this.request = new XMLHttpRequest();
    this.request.onreadystatechange = function () {
      if (this.request.readyState === this.request.DONE) {
        this.fileSize = parseInt(
          this.request.getResponseHeader("Content-Length")
        );
        this.loadNextChunk();
      }
    }.bind(this);
    this.request.onprogress = this.onProgress.bind(this);
    this.request.open("HEAD", this.url);
    this.request.send();
  };
  AjaxProgressiveSource.prototype.resume = function (secondsHeadroom) {
    if (this.isLoading || !this.throttled) {
      return;
    }
    var worstCaseLoadingTime = this.loadTime * 8 + 2;
    if (worstCaseLoadingTime > secondsHeadroom) {
      this.loadNextChunk();
    }
  };
  AjaxProgressiveSource.prototype.destroy = function () {
    this.request.abort();
    this.aborted = true;
  };
  AjaxProgressiveSource.prototype.loadNextChunk = function () {
    var start = this.loadedSize,
      end = Math.min(this.loadedSize + this.chunkSize - 1, this.fileSize - 1);
    if (start >= this.fileSize || this.aborted) {
      this.completed = true;
      if (this.onCompletedCallback) {
        this.onCompletedCallback(this);
      }
      return;
    }
    this.isLoading = true;
    this.loadStartTime = JSMpeg.Now();
    this.request = new XMLHttpRequest();
    this.request.onreadystatechange = function () {
      if (
        this.request.readyState === this.request.DONE &&
        this.request.status >= 200 &&
        this.request.status < 300
      ) {
        this.onChunkLoad(this.request.response);
      } else if (this.request.readyState === this.request.DONE) {
        if (this.loadFails++ < 3) {
          this.loadNextChunk();
        }
      }
    }.bind(this);
    if (start === 0) {
      this.request.onprogress = this.onProgress.bind(this);
    }
    this.request.open("GET", this.url + "?" + start + "-" + end);
    this.request.setRequestHeader("Range", "bytes=" + start + "-" + end);
    this.request.responseType = "arraybuffer";
    this.request.send();
  };
  AjaxProgressiveSource.prototype.onProgress = function (ev) {
    this.progress = ev.loaded / ev.total;
  };
  AjaxProgressiveSource.prototype.onChunkLoad = function (data) {
    var isFirstChunk = !this.established;
    this.established = true;
    this.progress = 1;
    this.loadedSize += data.byteLength;
    this.loadFails = 0;
    this.isLoading = false;
    if (isFirstChunk && this.onEstablishedCallback) {
      this.onEstablishedCallback(this);
    }
    if (this.destination) {
      this.destination.write(data);
    }
    this.loadTime = JSMpeg.Now() - this.loadStartTime;
    if (!this.throttled) {
      this.loadNextChunk();
    }
  };
  return AjaxProgressiveSource;
})();
JSMpeg.Source.WebSocket = (function () {
  "use strict";
  var WSSource = function (url, options) {
    this.url = url;
    this.options = options;
    this.socket = null;
    this.streaming = true;
    this.callbacks = { connect: [], data: [] };
    this.destination = null;
    this.reconnectInterval =
      options.reconnectInterval !== undefined ? options.reconnectInterval : 5;
    this.shouldAttemptReconnect = !!this.reconnectInterval;
    this.completed = false;
    this.established = false;
    this.progress = 0;
    this.reconnectTimeoutId = 0;
    this.onEstablishedCallback = options.onSourceEstablished;
    this.onCompletedCallback = options.onSourceCompleted;
  };
  WSSource.prototype.connect = function (destination) {
    this.destination = destination;
  };
  WSSource.prototype.destroy = function () {
    clearTimeout(this.reconnectTimeoutId);
    this.shouldAttemptReconnect = false;
    this.socket.close();
  };
  WSSource.prototype.start = function () {
    this.shouldAttemptReconnect = !!this.reconnectInterval;
    this.progress = 0;
    this.established = false;
    this.socket = new WebSocket(this.url, this.options.protocols || null);
    this.socket.binaryType = "arraybuffer";
    this.socket.onmessage = this.onMessage.bind(this);
    this.socket.onopen = this.onOpen.bind(this);
    this.socket.onerror = this.onClose.bind(this);
    this.socket.onclose = this.onClose.bind(this);
  };
  WSSource.prototype.resume = function (secondsHeadroom) {};
  WSSource.prototype.onOpen = function () {
    this.progress = 1;
  };
  WSSource.prototype.onClose = function () {
    if (this.shouldAttemptReconnect) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = setTimeout(
        function () {
          this.start();
        }.bind(this),
        this.reconnectInterval * 1e3
      );
    }
  };
  WSSource.prototype.onMessage = function (ev) {
    var isFirstChunk = !this.established;
    this.established = true;
    if (isFirstChunk && this.onEstablishedCallback) {
      this.onEstablishedCallback(this);
    }
    if (this.destination) {
      this.destination.write(ev.data);
    }
  };
  return WSSource;
})();
JSMpeg.Demuxer.TS = (function () {
  "use strict";
  var TS = function (options) {
    this.bits = null;
    this.leftoverBytes = null;
    this.guessVideoFrameEnd = true;
    this.pidsToStreamIds = {};
    this.pesPacketInfo = {};
    this.startTime = 0;
    this.currentTime = 0;
  };
  TS.prototype.connect = function (streamId, destination) {
    this.pesPacketInfo[streamId] = {
      destination: destination,
      currentLength: 0,
      totalLength: 0,
      pts: 0,
      buffers: [],
    };
  };
  TS.prototype.write = function (buffer) {
    if (this.leftoverBytes) {
      var totalLength = buffer.byteLength + this.leftoverBytes.byteLength;
      this.bits = new JSMpeg.BitBuffer(totalLength);
      this.bits.write([this.leftoverBytes, buffer]);
    } else {
      this.bits = new JSMpeg.BitBuffer(buffer);
    }
    while (this.bits.has(188 << 3) && this.parsePacket()) {}
    var leftoverCount = this.bits.byteLength - (this.bits.index >> 3);
    this.leftoverBytes =
      leftoverCount > 0 ? this.bits.bytes.subarray(this.bits.index >> 3) : null;
  };
  TS.prototype.parsePacket = function () {
    if (this.bits.read(8) !== 71) {
      if (!this.resync()) {
        return false;
      }
    }
    var end = (this.bits.index >> 3) + 187;
    var transportError = this.bits.read(1),
      payloadStart = this.bits.read(1),
      transportPriority = this.bits.read(1),
      pid = this.bits.read(13),
      transportScrambling = this.bits.read(2),
      adaptationField = this.bits.read(2),
      continuityCounter = this.bits.read(4);
    var streamId = this.pidsToStreamIds[pid];
    if (payloadStart && streamId) {
      var pi = this.pesPacketInfo[streamId];
      if (pi && pi.currentLength) {
        this.packetComplete(pi);
      }
    }
    if (adaptationField & 1) {
      if (adaptationField & 2) {
        var adaptationFieldLength = this.bits.read(8);
        this.bits.skip(adaptationFieldLength << 3);
      }
      if (payloadStart && this.bits.nextBytesAreStartCode()) {
        this.bits.skip(24);
        streamId = this.bits.read(8);
        this.pidsToStreamIds[pid] = streamId;
        var packetLength = this.bits.read(16);
        this.bits.skip(8);
        var ptsDtsFlag = this.bits.read(2);
        this.bits.skip(6);
        var headerLength = this.bits.read(8);
        var payloadBeginIndex = this.bits.index + (headerLength << 3);
        var pi = this.pesPacketInfo[streamId];
        if (pi) {
          var pts = 0;
          if (ptsDtsFlag & 2) {
            this.bits.skip(4);
            var p32_30 = this.bits.read(3);
            this.bits.skip(1);
            var p29_15 = this.bits.read(15);
            this.bits.skip(1);
            var p14_0 = this.bits.read(15);
            this.bits.skip(1);
            pts = (p32_30 * 1073741824 + p29_15 * 32768 + p14_0) / 9e4;
            this.currentTime = pts;
            if (this.startTime === -1) {
              this.startTime = pts;
            }
          }
          var payloadLength = packetLength
            ? packetLength - headerLength - 3
            : 0;
          this.packetStart(pi, pts, payloadLength);
        }
        this.bits.index = payloadBeginIndex;
      }
      if (streamId) {
        var pi = this.pesPacketInfo[streamId];
        if (pi) {
          var start = this.bits.index >> 3;
          var complete = this.packetAddData(pi, start, end);
          var hasPadding = !payloadStart && adaptationField & 2;
          if (complete || (this.guessVideoFrameEnd && hasPadding)) {
            this.packetComplete(pi);
          }
        }
      }
    }
    this.bits.index = end << 3;
    return true;
  };
  TS.prototype.resync = function () {
    if (!this.bits.has((188 * 6) << 3)) {
      return false;
    }
    var byteIndex = this.bits.index >> 3;
    for (var i = 0; i < 187; i++) {
      if (this.bits.bytes[byteIndex + i] === 71) {
        var foundSync = true;
        for (var j = 1; j < 5; j++) {
          if (this.bits.bytes[byteIndex + i + 188 * j] !== 71) {
            foundSync = false;
            break;
          }
        }
        if (foundSync) {
          this.bits.index = (byteIndex + i + 1) << 3;
          return true;
        }
      }
    }
    console.warn("JSMpeg: Possible garbage data. Skipping.");
    this.bits.skip(187 << 3);
    return false;
  };
  TS.prototype.packetStart = function (pi, pts, payloadLength) {
    pi.totalLength = payloadLength;
    pi.currentLength = 0;
    pi.pts = pts;
  };
  TS.prototype.packetAddData = function (pi, start, end) {
    pi.buffers.push(this.bits.bytes.subarray(start, end));
    pi.currentLength += end - start;
    var complete = pi.totalLength !== 0 && pi.currentLength >= pi.totalLength;
    return complete;
  };
  TS.prototype.packetComplete = function (pi) {
    pi.destination.write(pi.pts, pi.buffers);
    pi.totalLength = 0;
    pi.currentLength = 0;
    pi.buffers = [];
  };
  TS.STREAM = {
    PACK_HEADER: 186,
    SYSTEM_HEADER: 187,
    PROGRAM_MAP: 188,
    PRIVATE_1: 189,
    PADDING: 190,
    PRIVATE_2: 191,
    AUDIO_1: 192,
    VIDEO_1: 224,
    DIRECTORY: 255,
  };
  return TS;
})();
JSMpeg.Decoder.Base = (function () {
  "use strict";
  var BaseDecoder = function (options) {
    this.destination = null;
    this.canPlay = false;
    this.collectTimestamps = !options.streaming;
    this.bytesWritten = 0;
    this.timestamps = [];
    this.timestampIndex = 0;
    this.startTime = 0;
    this.decodedTime = 0;
    Object.defineProperty(this, "currentTime", { get: this.getCurrentTime });
  };
  BaseDecoder.prototype.destroy = function () {};
  BaseDecoder.prototype.connect = function (destination) {
    this.destination = destination;
  };
  BaseDecoder.prototype.bufferGetIndex = function () {
    return this.bits.index;
  };
  BaseDecoder.prototype.bufferSetIndex = function (index) {
    this.bits.index = index;
  };
  BaseDecoder.prototype.bufferWrite = function (buffers) {
    return this.bits.write(buffers);
  };
  BaseDecoder.prototype.write = function (pts, buffers) {
    if (this.collectTimestamps) {
      if (this.timestamps.length === 0) {
        this.startTime = pts;
        this.decodedTime = pts;
      }
      this.timestamps.push({ index: this.bytesWritten << 3, time: pts });
    }
    this.bytesWritten += this.bufferWrite(buffers);
    this.canPlay = true;
  };
  BaseDecoder.prototype.seek = function (time) {
    if (!this.collectTimestamps) {
      return;
    }
    this.timestampIndex = 0;
    for (var i = 0; i < this.timestamps.length; i++) {
      if (this.timestamps[i].time > time) {
        break;
      }
      this.timestampIndex = i;
    }
    var ts = this.timestamps[this.timestampIndex];
    if (ts) {
      this.bufferSetIndex(ts.index);
      this.decodedTime = ts.time;
    } else {
      this.bufferSetIndex(0);
      this.decodedTime = this.startTime;
    }
  };
  BaseDecoder.prototype.decode = function () {
    this.advanceDecodedTime(0);
  };
  BaseDecoder.prototype.advanceDecodedTime = function (seconds) {
    if (this.collectTimestamps) {
      var newTimestampIndex = -1;
      var currentIndex = this.bufferGetIndex();
      for (var i = this.timestampIndex; i < this.timestamps.length; i++) {
        if (this.timestamps[i].index > currentIndex) {
          break;
        }
        newTimestampIndex = i;
      }
      if (
        newTimestampIndex !== -1 &&
        newTimestampIndex !== this.timestampIndex
      ) {
        this.timestampIndex = newTimestampIndex;
        this.decodedTime = this.timestamps[this.timestampIndex].time;
        return;
      }
    }
    this.decodedTime += seconds;
  };
  BaseDecoder.prototype.getCurrentTime = function () {
    return this.decodedTime;
  };
  return BaseDecoder;
})();
JSMpeg.Decoder.MPEG1Video = (function () {
  "use strict";
  var MPEG1 = function (options) {
    JSMpeg.Decoder.Base.call(this, options);
    this.onDecodeCallback = options.onVideoDecode;
    var bufferSize = options.videoBufferSize || 512 * 1024;
    var bufferMode = options.streaming
      ? JSMpeg.BitBuffer.MODE.EVICT
      : JSMpeg.BitBuffer.MODE.EXPAND;
    this.bits = new JSMpeg.BitBuffer(bufferSize, bufferMode);
    this.customIntraQuantMatrix = new Uint8Array(64);
    this.customNonIntraQuantMatrix = new Uint8Array(64);
    this.blockData = new Int32Array(64);
    this.currentFrame = 0;
    this.decodeFirstFrame = options.decodeFirstFrame !== false;
  };
  MPEG1.prototype = Object.create(JSMpeg.Decoder.Base.prototype);
  MPEG1.prototype.constructor = MPEG1;
  MPEG1.prototype.write = function (pts, buffers) {
    JSMpeg.Decoder.Base.prototype.write.call(this, pts, buffers);
    if (!this.hasSequenceHeader) {
      if (this.bits.findStartCode(MPEG1.START.SEQUENCE) === -1) {
        return false;
      }
      this.decodeSequenceHeader();
      if (this.decodeFirstFrame) {
        this.decode();
      }
    }
  };
  MPEG1.prototype.decode = function () {
    var startTime = JSMpeg.Now();
    if (!this.hasSequenceHeader) {
      return false;
    }
    if (this.bits.findStartCode(MPEG1.START.PICTURE) === -1) {
      var bufferedBytes = this.bits.byteLength - (this.bits.index >> 3);
      return false;
    }
    this.decodePicture();
    this.advanceDecodedTime(1 / this.frameRate);
    var elapsedTime = JSMpeg.Now() - startTime;
    if (this.onDecodeCallback) {
      this.onDecodeCallback(this, elapsedTime);
    }
    return true;
  };
  MPEG1.prototype.readHuffman = function (codeTable) {
    var state = 0;
    do {
      state = codeTable[state + this.bits.read(1)];
    } while (state >= 0 && codeTable[state] !== 0);
    return codeTable[state + 2];
  };
  MPEG1.prototype.frameRate = 30;
  MPEG1.prototype.decodeSequenceHeader = function () {
    var newWidth = this.bits.read(12),
      newHeight = this.bits.read(12);
    this.bits.skip(4);
    this.frameRate = MPEG1.PICTURE_RATE[this.bits.read(4)];
    this.bits.skip(18 + 1 + 10 + 1);
    if (newWidth !== this.width || newHeight !== this.height) {
      this.width = newWidth;
      this.height = newHeight;
      this.initBuffers();
      if (this.destination) {
        this.destination.resize(newWidth, newHeight);
      }
    }
    if (this.bits.read(1)) {
      for (var i = 0; i < 64; i++) {
        this.customIntraQuantMatrix[MPEG1.ZIG_ZAG[i]] = this.bits.read(8);
      }
      this.intraQuantMatrix = this.customIntraQuantMatrix;
    }
    if (this.bits.read(1)) {
      for (var i = 0; i < 64; i++) {
        var idx = MPEG1.ZIG_ZAG[i];
        this.customNonIntraQuantMatrix[idx] = this.bits.read(8);
      }
      this.nonIntraQuantMatrix = this.customNonIntraQuantMatrix;
    }
    this.hasSequenceHeader = true;
  };
  MPEG1.prototype.initBuffers = function () {
    this.intraQuantMatrix = MPEG1.DEFAULT_INTRA_QUANT_MATRIX;
    this.nonIntraQuantMatrix = MPEG1.DEFAULT_NON_INTRA_QUANT_MATRIX;
    this.mbWidth = (this.width + 15) >> 4;
    this.mbHeight = (this.height + 15) >> 4;
    this.mbSize = this.mbWidth * this.mbHeight;
    this.codedWidth = this.mbWidth << 4;
    this.codedHeight = this.mbHeight << 4;
    this.codedSize = this.codedWidth * this.codedHeight;
    this.halfWidth = this.mbWidth << 3;
    this.halfHeight = this.mbHeight << 3;
    this.currentY = new Uint8ClampedArray(this.codedSize);
    this.currentY32 = new Uint32Array(this.currentY.buffer);
    this.currentCr = new Uint8ClampedArray(this.codedSize >> 2);
    this.currentCr32 = new Uint32Array(this.currentCr.buffer);
    this.currentCb = new Uint8ClampedArray(this.codedSize >> 2);
    this.currentCb32 = new Uint32Array(this.currentCb.buffer);
    this.forwardY = new Uint8ClampedArray(this.codedSize);
    this.forwardY32 = new Uint32Array(this.forwardY.buffer);
    this.forwardCr = new Uint8ClampedArray(this.codedSize >> 2);
    this.forwardCr32 = new Uint32Array(this.forwardCr.buffer);
    this.forwardCb = new Uint8ClampedArray(this.codedSize >> 2);
    this.forwardCb32 = new Uint32Array(this.forwardCb.buffer);
  };
  MPEG1.prototype.currentY = null;
  MPEG1.prototype.currentCr = null;
  MPEG1.prototype.currentCb = null;
  MPEG1.prototype.pictureType = 0;
  MPEG1.prototype.forwardY = null;
  MPEG1.prototype.forwardCr = null;
  MPEG1.prototype.forwardCb = null;
  MPEG1.prototype.fullPelForward = false;
  MPEG1.prototype.forwardFCode = 0;
  MPEG1.prototype.forwardRSize = 0;
  MPEG1.prototype.forwardF = 0;
  MPEG1.prototype.decodePicture = function (skipOutput) {
    this.currentFrame++;
    this.bits.skip(10);
    this.pictureType = this.bits.read(3);
    this.bits.skip(16);
    if (this.pictureType <= 0 || this.pictureType >= MPEG1.PICTURE_TYPE.B) {
      return;
    }
    if (this.pictureType === MPEG1.PICTURE_TYPE.PREDICTIVE) {
      this.fullPelForward = this.bits.read(1);
      this.forwardFCode = this.bits.read(3);
      if (this.forwardFCode === 0) {
        return;
      }
      this.forwardRSize = this.forwardFCode - 1;
      this.forwardF = 1 << this.forwardRSize;
    }
    var code = 0;
    do {
      code = this.bits.findNextStartCode();
    } while (code === MPEG1.START.EXTENSION || code === MPEG1.START.USER_DATA);
    while (code >= MPEG1.START.SLICE_FIRST && code <= MPEG1.START.SLICE_LAST) {
      this.decodeSlice(code & 255);
      code = this.bits.findNextStartCode();
    }
    if (code !== -1) {
      this.bits.rewind(32);
    }
    if (this.destination) {
      this.destination.render(
        this.currentY,
        this.currentCr,
        this.currentCb,
        true
      );
    }
    if (
      this.pictureType === MPEG1.PICTURE_TYPE.INTRA ||
      this.pictureType === MPEG1.PICTURE_TYPE.PREDICTIVE
    ) {
      var tmpY = this.forwardY,
        tmpY32 = this.forwardY32,
        tmpCr = this.forwardCr,
        tmpCr32 = this.forwardCr32,
        tmpCb = this.forwardCb,
        tmpCb32 = this.forwardCb32;
      this.forwardY = this.currentY;
      this.forwardY32 = this.currentY32;
      this.forwardCr = this.currentCr;
      this.forwardCr32 = this.currentCr32;
      this.forwardCb = this.currentCb;
      this.forwardCb32 = this.currentCb32;
      this.currentY = tmpY;
      this.currentY32 = tmpY32;
      this.currentCr = tmpCr;
      this.currentCr32 = tmpCr32;
      this.currentCb = tmpCb;
      this.currentCb32 = tmpCb32;
    }
  };
  MPEG1.prototype.quantizerScale = 0;
  MPEG1.prototype.sliceBegin = false;
  MPEG1.prototype.decodeSlice = function (slice) {
    this.sliceBegin = true;
    this.macroblockAddress = (slice - 1) * this.mbWidth - 1;
    this.motionFwH = this.motionFwHPrev = 0;
    this.motionFwV = this.motionFwVPrev = 0;
    this.dcPredictorY = 128;
    this.dcPredictorCr = 128;
    this.dcPredictorCb = 128;
    this.quantizerScale = this.bits.read(5);
    while (this.bits.read(1)) {
      this.bits.skip(8);
    }
    do {
      this.decodeMacroblock();
    } while (!this.bits.nextBytesAreStartCode());
  };
  MPEG1.prototype.macroblockAddress = 0;
  MPEG1.prototype.mbRow = 0;
  MPEG1.prototype.mbCol = 0;
  MPEG1.prototype.macroblockType = 0;
  MPEG1.prototype.macroblockIntra = false;
  MPEG1.prototype.macroblockMotFw = false;
  MPEG1.prototype.motionFwH = 0;
  MPEG1.prototype.motionFwV = 0;
  MPEG1.prototype.motionFwHPrev = 0;
  MPEG1.prototype.motionFwVPrev = 0;
  MPEG1.prototype.decodeMacroblock = function () {
    var increment = 0,
      t = this.readHuffman(MPEG1.MACROBLOCK_ADDRESS_INCREMENT);
    while (t === 34) {
      t = this.readHuffman(MPEG1.MACROBLOCK_ADDRESS_INCREMENT);
    }
    while (t === 35) {
      increment += 33;
      t = this.readHuffman(MPEG1.MACROBLOCK_ADDRESS_INCREMENT);
    }
    increment += t;
    if (this.sliceBegin) {
      this.sliceBegin = false;
      this.macroblockAddress += increment;
    } else {
      if (this.macroblockAddress + increment >= this.mbSize) {
        return;
      }
      if (increment > 1) {
        this.dcPredictorY = 128;
        this.dcPredictorCr = 128;
        this.dcPredictorCb = 128;
        if (this.pictureType === MPEG1.PICTURE_TYPE.PREDICTIVE) {
          this.motionFwH = this.motionFwHPrev = 0;
          this.motionFwV = this.motionFwVPrev = 0;
        }
      }
      while (increment > 1) {
        this.macroblockAddress++;
        this.mbRow = (this.macroblockAddress / this.mbWidth) | 0;
        this.mbCol = this.macroblockAddress % this.mbWidth;
        this.copyMacroblock(
          this.motionFwH,
          this.motionFwV,
          this.forwardY,
          this.forwardCr,
          this.forwardCb
        );
        increment--;
      }
      this.macroblockAddress++;
    }
    this.mbRow = (this.macroblockAddress / this.mbWidth) | 0;
    this.mbCol = this.macroblockAddress % this.mbWidth;
    var mbTable = MPEG1.MACROBLOCK_TYPE[this.pictureType];
    this.macroblockType = this.readHuffman(mbTable);
    this.macroblockIntra = this.macroblockType & 1;
    this.macroblockMotFw = this.macroblockType & 8;
    if ((this.macroblockType & 16) !== 0) {
      this.quantizerScale = this.bits.read(5);
    }
    if (this.macroblockIntra) {
      this.motionFwH = this.motionFwHPrev = 0;
      this.motionFwV = this.motionFwVPrev = 0;
    } else {
      this.dcPredictorY = 128;
      this.dcPredictorCr = 128;
      this.dcPredictorCb = 128;
      this.decodeMotionVectors();
      this.copyMacroblock(
        this.motionFwH,
        this.motionFwV,
        this.forwardY,
        this.forwardCr,
        this.forwardCb
      );
    }
    var cbp =
      (this.macroblockType & 2) !== 0
        ? this.readHuffman(MPEG1.CODE_BLOCK_PATTERN)
        : this.macroblockIntra
        ? 63
        : 0;
    for (var block = 0, mask = 32; block < 6; block++) {
      if ((cbp & mask) !== 0) {
        this.decodeBlock(block);
      }
      mask >>= 1;
    }
  };
  MPEG1.prototype.decodeMotionVectors = function () {
    var code,
      d,
      r = 0;
    if (this.macroblockMotFw) {
      code = this.readHuffman(MPEG1.MOTION);
      if (code !== 0 && this.forwardF !== 1) {
        r = this.bits.read(this.forwardRSize);
        d = ((Math.abs(code) - 1) << this.forwardRSize) + r + 1;
        if (code < 0) {
          d = -d;
        }
      } else {
        d = code;
      }
      this.motionFwHPrev += d;
      if (this.motionFwHPrev > (this.forwardF << 4) - 1) {
        this.motionFwHPrev -= this.forwardF << 5;
      } else if (this.motionFwHPrev < -this.forwardF << 4) {
        this.motionFwHPrev += this.forwardF << 5;
      }
      this.motionFwH = this.motionFwHPrev;
      if (this.fullPelForward) {
        this.motionFwH <<= 1;
      }
      code = this.readHuffman(MPEG1.MOTION);
      if (code !== 0 && this.forwardF !== 1) {
        r = this.bits.read(this.forwardRSize);
        d = ((Math.abs(code) - 1) << this.forwardRSize) + r + 1;
        if (code < 0) {
          d = -d;
        }
      } else {
        d = code;
      }
      this.motionFwVPrev += d;
      if (this.motionFwVPrev > (this.forwardF << 4) - 1) {
        this.motionFwVPrev -= this.forwardF << 5;
      } else if (this.motionFwVPrev < -this.forwardF << 4) {
        this.motionFwVPrev += this.forwardF << 5;
      }
      this.motionFwV = this.motionFwVPrev;
      if (this.fullPelForward) {
        this.motionFwV <<= 1;
      }
    } else if (this.pictureType === MPEG1.PICTURE_TYPE.PREDICTIVE) {
      this.motionFwH = this.motionFwHPrev = 0;
      this.motionFwV = this.motionFwVPrev = 0;
    }
  };
  MPEG1.prototype.copyMacroblock = function (motionH, motionV, sY, sCr, sCb) {
    var width, scan, H, V, oddH, oddV, src, dest, last;
    var dY = this.currentY32,
      dCb = this.currentCb32,
      dCr = this.currentCr32;
    width = this.codedWidth;
    scan = width - 16;
    H = motionH >> 1;
    V = motionV >> 1;
    oddH = (motionH & 1) === 1;
    oddV = (motionV & 1) === 1;
    src = ((this.mbRow << 4) + V) * width + (this.mbCol << 4) + H;
    dest = (this.mbRow * width + this.mbCol) << 2;
    last = dest + (width << 2);
    var x, y1, y2, y;
    if (oddH) {
      if (oddV) {
        while (dest < last) {
          y1 = sY[src] + sY[src + width];
          src++;
          for (x = 0; x < 4; x++) {
            y2 = sY[src] + sY[src + width];
            src++;
            y = ((y1 + y2 + 2) >> 2) & 255;
            y1 = sY[src] + sY[src + width];
            src++;
            y |= ((y1 + y2 + 2) << 6) & 65280;
            y2 = sY[src] + sY[src + width];
            src++;
            y |= ((y1 + y2 + 2) << 14) & 16711680;
            y1 = sY[src] + sY[src + width];
            src++;
            y |= ((y1 + y2 + 2) << 22) & 4278190080;
            dY[dest++] = y;
          }
          dest += scan >> 2;
          src += scan - 1;
        }
      } else {
        while (dest < last) {
          y1 = sY[src++];
          for (x = 0; x < 4; x++) {
            y2 = sY[src++];
            y = ((y1 + y2 + 1) >> 1) & 255;
            y1 = sY[src++];
            y |= ((y1 + y2 + 1) << 7) & 65280;
            y2 = sY[src++];
            y |= ((y1 + y2 + 1) << 15) & 16711680;
            y1 = sY[src++];
            y |= ((y1 + y2 + 1) << 23) & 4278190080;
            dY[dest++] = y;
          }
          dest += scan >> 2;
          src += scan - 1;
        }
      }
    } else {
      if (oddV) {
        while (dest < last) {
          for (x = 0; x < 4; x++) {
            y = ((sY[src] + sY[src + width] + 1) >> 1) & 255;
            src++;
            y |= ((sY[src] + sY[src + width] + 1) << 7) & 65280;
            src++;
            y |= ((sY[src] + sY[src + width] + 1) << 15) & 16711680;
            src++;
            y |= ((sY[src] + sY[src + width] + 1) << 23) & 4278190080;
            src++;
            dY[dest++] = y;
          }
          dest += scan >> 2;
          src += scan;
        }
      } else {
        while (dest < last) {
          for (x = 0; x < 4; x++) {
            y = sY[src];
            src++;
            y |= sY[src] << 8;
            src++;
            y |= sY[src] << 16;
            src++;
            y |= sY[src] << 24;
            src++;
            dY[dest++] = y;
          }
          dest += scan >> 2;
          src += scan;
        }
      }
    }
    width = this.halfWidth;
    scan = width - 8;
    H = (motionH / 2) >> 1;
    V = (motionV / 2) >> 1;
    oddH = ((motionH / 2) & 1) === 1;
    oddV = ((motionV / 2) & 1) === 1;
    src = ((this.mbRow << 3) + V) * width + (this.mbCol << 3) + H;
    dest = (this.mbRow * width + this.mbCol) << 1;
    last = dest + (width << 1);
    var cr1, cr2, cr, cb1, cb2, cb;
    if (oddH) {
      if (oddV) {
        while (dest < last) {
          cr1 = sCr[src] + sCr[src + width];
          cb1 = sCb[src] + sCb[src + width];
          src++;
          for (x = 0; x < 2; x++) {
            cr2 = sCr[src] + sCr[src + width];
            cb2 = sCb[src] + sCb[src + width];
            src++;
            cr = ((cr1 + cr2 + 2) >> 2) & 255;
            cb = ((cb1 + cb2 + 2) >> 2) & 255;
            cr1 = sCr[src] + sCr[src + width];
            cb1 = sCb[src] + sCb[src + width];
            src++;
            cr |= ((cr1 + cr2 + 2) << 6) & 65280;
            cb |= ((cb1 + cb2 + 2) << 6) & 65280;
            cr2 = sCr[src] + sCr[src + width];
            cb2 = sCb[src] + sCb[src + width];
            src++;
            cr |= ((cr1 + cr2 + 2) << 14) & 16711680;
            cb |= ((cb1 + cb2 + 2) << 14) & 16711680;
            cr1 = sCr[src] + sCr[src + width];
            cb1 = sCb[src] + sCb[src + width];
            src++;
            cr |= ((cr1 + cr2 + 2) << 22) & 4278190080;
            cb |= ((cb1 + cb2 + 2) << 22) & 4278190080;
            dCr[dest] = cr;
            dCb[dest] = cb;
            dest++;
          }
          dest += scan >> 2;
          src += scan - 1;
        }
      } else {
        while (dest < last) {
          cr1 = sCr[src];
          cb1 = sCb[src];
          src++;
          for (x = 0; x < 2; x++) {
            cr2 = sCr[src];
            cb2 = sCb[src++];
            cr = ((cr1 + cr2 + 1) >> 1) & 255;
            cb = ((cb1 + cb2 + 1) >> 1) & 255;
            cr1 = sCr[src];
            cb1 = sCb[src++];
            cr |= ((cr1 + cr2 + 1) << 7) & 65280;
            cb |= ((cb1 + cb2 + 1) << 7) & 65280;
            cr2 = sCr[src];
            cb2 = sCb[src++];
            cr |= ((cr1 + cr2 + 1) << 15) & 16711680;
            cb |= ((cb1 + cb2 + 1) << 15) & 16711680;
            cr1 = sCr[src];
            cb1 = sCb[src++];
            cr |= ((cr1 + cr2 + 1) << 23) & 4278190080;
            cb |= ((cb1 + cb2 + 1) << 23) & 4278190080;
            dCr[dest] = cr;
            dCb[dest] = cb;
            dest++;
          }
          dest += scan >> 2;
          src += scan - 1;
        }
      }
    } else {
      if (oddV) {
        while (dest < last) {
          for (x = 0; x < 2; x++) {
            cr = ((sCr[src] + sCr[src + width] + 1) >> 1) & 255;
            cb = ((sCb[src] + sCb[src + width] + 1) >> 1) & 255;
            src++;
            cr |= ((sCr[src] + sCr[src + width] + 1) << 7) & 65280;
            cb |= ((sCb[src] + sCb[src + width] + 1) << 7) & 65280;
            src++;
            cr |= ((sCr[src] + sCr[src + width] + 1) << 15) & 16711680;
            cb |= ((sCb[src] + sCb[src + width] + 1) << 15) & 16711680;
            src++;
            cr |= ((sCr[src] + sCr[src + width] + 1) << 23) & 4278190080;
            cb |= ((sCb[src] + sCb[src + width] + 1) << 23) & 4278190080;
            src++;
            dCr[dest] = cr;
            dCb[dest] = cb;
            dest++;
          }
          dest += scan >> 2;
          src += scan;
        }
      } else {
        while (dest < last) {
          for (x = 0; x < 2; x++) {
            cr = sCr[src];
            cb = sCb[src];
            src++;
            cr |= sCr[src] << 8;
            cb |= sCb[src] << 8;
            src++;
            cr |= sCr[src] << 16;
            cb |= sCb[src] << 16;
            src++;
            cr |= sCr[src] << 24;
            cb |= sCb[src] << 24;
            src++;
            dCr[dest] = cr;
            dCb[dest] = cb;
            dest++;
          }
          dest += scan >> 2;
          src += scan;
        }
      }
    }
  };
  MPEG1.prototype.dcPredictorY = 0;
  MPEG1.prototype.dcPredictorCr = 0;
  MPEG1.prototype.dcPredictorCb = 0;
  MPEG1.prototype.blockData = null;
  MPEG1.prototype.decodeBlock = function (block) {
    var n = 0,
      quantMatrix;
    if (this.macroblockIntra) {
      var predictor, dctSize;
      if (block < 4) {
        predictor = this.dcPredictorY;
        dctSize = this.readHuffman(MPEG1.DCT_DC_SIZE_LUMINANCE);
      } else {
        predictor = block === 4 ? this.dcPredictorCr : this.dcPredictorCb;
        dctSize = this.readHuffman(MPEG1.DCT_DC_SIZE_CHROMINANCE);
      }
      if (dctSize > 0) {
        var differential = this.bits.read(dctSize);
        if ((differential & (1 << (dctSize - 1))) !== 0) {
          this.blockData[0] = predictor + differential;
        } else {
          this.blockData[0] =
            predictor + ((-1 << dctSize) | (differential + 1));
        }
      } else {
        this.blockData[0] = predictor;
      }
      if (block < 4) {
        this.dcPredictorY = this.blockData[0];
      } else if (block === 4) {
        this.dcPredictorCr = this.blockData[0];
      } else {
        this.dcPredictorCb = this.blockData[0];
      }
      this.blockData[0] <<= 3 + 5;
      quantMatrix = this.intraQuantMatrix;
      n = 1;
    } else {
      quantMatrix = this.nonIntraQuantMatrix;
    }
    var level = 0;
    while (true) {
      var run = 0,
        coeff = this.readHuffman(MPEG1.DCT_COEFF);
      if (coeff === 1 && n > 0 && this.bits.read(1) === 0) {
        break;
      }
      if (coeff === 65535) {
        run = this.bits.read(6);
        level = this.bits.read(8);
        if (level === 0) {
          level = this.bits.read(8);
        } else if (level === 128) {
          level = this.bits.read(8) - 256;
        } else if (level > 128) {
          level = level - 256;
        }
      } else {
        run = coeff >> 8;
        level = coeff & 255;
        if (this.bits.read(1)) {
          level = -level;
        }
      }
      n += run;
      var dezigZagged = MPEG1.ZIG_ZAG[n];
      n++;
      level <<= 1;
      if (!this.macroblockIntra) {
        level += level < 0 ? -1 : 1;
      }
      level = (level * this.quantizerScale * quantMatrix[dezigZagged]) >> 4;
      if ((level & 1) === 0) {
        level -= level > 0 ? 1 : -1;
      }
      if (level > 2047) {
        level = 2047;
      } else if (level < -2048) {
        level = -2048;
      }
      this.blockData[dezigZagged] =
        level * MPEG1.PREMULTIPLIER_MATRIX[dezigZagged];
    }
    var destArray, destIndex, scan;
    if (block < 4) {
      destArray = this.currentY;
      scan = this.codedWidth - 8;
      destIndex = (this.mbRow * this.codedWidth + this.mbCol) << 4;
      if ((block & 1) !== 0) {
        destIndex += 8;
      }
      if ((block & 2) !== 0) {
        destIndex += this.codedWidth << 3;
      }
    } else {
      destArray = block === 4 ? this.currentCb : this.currentCr;
      scan = (this.codedWidth >> 1) - 8;
      destIndex = ((this.mbRow * this.codedWidth) << 2) + (this.mbCol << 3);
    }
    if (this.macroblockIntra) {
      if (n === 1) {
        MPEG1.CopyValueToDestination(
          (this.blockData[0] + 128) >> 8,
          destArray,
          destIndex,
          scan
        );
        this.blockData[0] = 0;
      } else {
        MPEG1.IDCT(this.blockData);
        MPEG1.CopyBlockToDestination(
          this.blockData,
          destArray,
          destIndex,
          scan
        );
        JSMpeg.Fill(this.blockData, 0);
      }
    } else {
      if (n === 1) {
        MPEG1.AddValueToDestination(
          (this.blockData[0] + 128) >> 8,
          destArray,
          destIndex,
          scan
        );
        this.blockData[0] = 0;
      } else {
        MPEG1.IDCT(this.blockData);
        MPEG1.AddBlockToDestination(this.blockData, destArray, destIndex, scan);
        JSMpeg.Fill(this.blockData, 0);
      }
    }
    n = 0;
  };
  MPEG1.CopyBlockToDestination = function (block, dest, index, scan) {
    for (var n = 0; n < 64; n += 8, index += scan + 8) {
      dest[index + 0] = block[n + 0];
      dest[index + 1] = block[n + 1];
      dest[index + 2] = block[n + 2];
      dest[index + 3] = block[n + 3];
      dest[index + 4] = block[n + 4];
      dest[index + 5] = block[n + 5];
      dest[index + 6] = block[n + 6];
      dest[index + 7] = block[n + 7];
    }
  };
  MPEG1.AddBlockToDestination = function (block, dest, index, scan) {
    for (var n = 0; n < 64; n += 8, index += scan + 8) {
      dest[index + 0] += block[n + 0];
      dest[index + 1] += block[n + 1];
      dest[index + 2] += block[n + 2];
      dest[index + 3] += block[n + 3];
      dest[index + 4] += block[n + 4];
      dest[index + 5] += block[n + 5];
      dest[index + 6] += block[n + 6];
      dest[index + 7] += block[n + 7];
    }
  };
  MPEG1.CopyValueToDestination = function (value, dest, index, scan) {
    for (var n = 0; n < 64; n += 8, index += scan + 8) {
      dest[index + 0] = value;
      dest[index + 1] = value;
      dest[index + 2] = value;
      dest[index + 3] = value;
      dest[index + 4] = value;
      dest[index + 5] = value;
      dest[index + 6] = value;
      dest[index + 7] = value;
    }
  };
  MPEG1.AddValueToDestination = function (value, dest, index, scan) {
    for (var n = 0; n < 64; n += 8, index += scan + 8) {
      dest[index + 0] += value;
      dest[index + 1] += value;
      dest[index + 2] += value;
      dest[index + 3] += value;
      dest[index + 4] += value;
      dest[index + 5] += value;
      dest[index + 6] += value;
      dest[index + 7] += value;
    }
  };
  MPEG1.IDCT = function (block) {
    var b1,
      b3,
      b4,
      b6,
      b7,
      tmp1,
      tmp2,
      m0,
      x0,
      x1,
      x2,
      x3,
      x4,
      y3,
      y4,
      y5,
      y6,
      y7;
    for (var i = 0; i < 8; ++i) {
      b1 = block[4 * 8 + i];
      b3 = block[2 * 8 + i] + block[6 * 8 + i];
      b4 = block[5 * 8 + i] - block[3 * 8 + i];
      tmp1 = block[1 * 8 + i] + block[7 * 8 + i];
      tmp2 = block[3 * 8 + i] + block[5 * 8 + i];
      b6 = block[1 * 8 + i] - block[7 * 8 + i];
      b7 = tmp1 + tmp2;
      m0 = block[0 * 8 + i];
      x4 = ((b6 * 473 - b4 * 196 + 128) >> 8) - b7;
      x0 = x4 - (((tmp1 - tmp2) * 362 + 128) >> 8);
      x1 = m0 - b1;
      x2 = (((block[2 * 8 + i] - block[6 * 8 + i]) * 362 + 128) >> 8) - b3;
      x3 = m0 + b1;
      y3 = x1 + x2;
      y4 = x3 + b3;
      y5 = x1 - x2;
      y6 = x3 - b3;
      y7 = -x0 - ((b4 * 473 + b6 * 196 + 128) >> 8);
      block[0 * 8 + i] = b7 + y4;
      block[1 * 8 + i] = x4 + y3;
      block[2 * 8 + i] = y5 - x0;
      block[3 * 8 + i] = y6 - y7;
      block[4 * 8 + i] = y6 + y7;
      block[5 * 8 + i] = x0 + y5;
      block[6 * 8 + i] = y3 - x4;
      block[7 * 8 + i] = y4 - b7;
    }
    for (var i = 0; i < 64; i += 8) {
      b1 = block[4 + i];
      b3 = block[2 + i] + block[6 + i];
      b4 = block[5 + i] - block[3 + i];
      tmp1 = block[1 + i] + block[7 + i];
      tmp2 = block[3 + i] + block[5 + i];
      b6 = block[1 + i] - block[7 + i];
      b7 = tmp1 + tmp2;
      m0 = block[0 + i];
      x4 = ((b6 * 473 - b4 * 196 + 128) >> 8) - b7;
      x0 = x4 - (((tmp1 - tmp2) * 362 + 128) >> 8);
      x1 = m0 - b1;
      x2 = (((block[2 + i] - block[6 + i]) * 362 + 128) >> 8) - b3;
      x3 = m0 + b1;
      y3 = x1 + x2;
      y4 = x3 + b3;
      y5 = x1 - x2;
      y6 = x3 - b3;
      y7 = -x0 - ((b4 * 473 + b6 * 196 + 128) >> 8);
      block[0 + i] = (b7 + y4 + 128) >> 8;
      block[1 + i] = (x4 + y3 + 128) >> 8;
      block[2 + i] = (y5 - x0 + 128) >> 8;
      block[3 + i] = (y6 - y7 + 128) >> 8;
      block[4 + i] = (y6 + y7 + 128) >> 8;
      block[5 + i] = (x0 + y5 + 128) >> 8;
      block[6 + i] = (y3 - x4 + 128) >> 8;
      block[7 + i] = (y4 - b7 + 128) >> 8;
    }
  };
  MPEG1.PICTURE_RATE = [
    0, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 0, 0, 0, 0, 0, 0, 0,
  ];
  MPEG1.ZIG_ZAG = new Uint8Array([
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
    48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61,
    54, 47, 55, 62, 63,
  ]);
  MPEG1.DEFAULT_INTRA_QUANT_MATRIX = new Uint8Array([
    8, 16, 19, 22, 26, 27, 29, 34, 16, 16, 22, 24, 27, 29, 34, 37, 19, 22, 26,
    27, 29, 34, 34, 38, 22, 22, 26, 27, 29, 34, 37, 40, 22, 26, 27, 29, 32, 35,
    40, 48, 26, 27, 29, 32, 35, 40, 48, 58, 26, 27, 29, 34, 38, 46, 56, 69, 27,
    29, 35, 38, 46, 56, 69, 83,
  ]);
  MPEG1.DEFAULT_NON_INTRA_QUANT_MATRIX = new Uint8Array([
    16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16,
    16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16,
    16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16,
    16, 16, 16, 16, 16, 16, 16,
  ]);
  MPEG1.PREMULTIPLIER_MATRIX = new Uint8Array([
    32, 44, 42, 38, 32, 25, 17, 9, 44, 62, 58, 52, 44, 35, 24, 12, 42, 58, 55,
    49, 42, 33, 23, 12, 38, 52, 49, 44, 38, 30, 20, 10, 32, 44, 42, 38, 32, 25,
    17, 9, 25, 35, 33, 30, 25, 20, 14, 7, 17, 24, 23, 20, 17, 14, 9, 5, 9, 12,
    12, 10, 9, 7, 5, 2,
  ]);
  MPEG1.MACROBLOCK_ADDRESS_INCREMENT = new Int16Array([
    1 * 3,
    2 * 3,
    0,
    3 * 3,
    4 * 3,
    0,
    0,
    0,
    1,
    5 * 3,
    6 * 3,
    0,
    7 * 3,
    8 * 3,
    0,
    9 * 3,
    10 * 3,
    0,
    11 * 3,
    12 * 3,
    0,
    0,
    0,
    3,
    0,
    0,
    2,
    13 * 3,
    14 * 3,
    0,
    15 * 3,
    16 * 3,
    0,
    0,
    0,
    5,
    0,
    0,
    4,
    17 * 3,
    18 * 3,
    0,
    19 * 3,
    20 * 3,
    0,
    0,
    0,
    7,
    0,
    0,
    6,
    21 * 3,
    22 * 3,
    0,
    23 * 3,
    24 * 3,
    0,
    25 * 3,
    26 * 3,
    0,
    27 * 3,
    28 * 3,
    0,
    -1,
    29 * 3,
    0,
    -1,
    30 * 3,
    0,
    31 * 3,
    32 * 3,
    0,
    33 * 3,
    34 * 3,
    0,
    35 * 3,
    36 * 3,
    0,
    37 * 3,
    38 * 3,
    0,
    0,
    0,
    9,
    0,
    0,
    8,
    39 * 3,
    40 * 3,
    0,
    41 * 3,
    42 * 3,
    0,
    43 * 3,
    44 * 3,
    0,
    45 * 3,
    46 * 3,
    0,
    0,
    0,
    15,
    0,
    0,
    14,
    0,
    0,
    13,
    0,
    0,
    12,
    0,
    0,
    11,
    0,
    0,
    10,
    47 * 3,
    -1,
    0,
    -1,
    48 * 3,
    0,
    49 * 3,
    50 * 3,
    0,
    51 * 3,
    52 * 3,
    0,
    53 * 3,
    54 * 3,
    0,
    55 * 3,
    56 * 3,
    0,
    57 * 3,
    58 * 3,
    0,
    59 * 3,
    60 * 3,
    0,
    61 * 3,
    -1,
    0,
    -1,
    62 * 3,
    0,
    63 * 3,
    64 * 3,
    0,
    65 * 3,
    66 * 3,
    0,
    67 * 3,
    68 * 3,
    0,
    69 * 3,
    70 * 3,
    0,
    71 * 3,
    72 * 3,
    0,
    73 * 3,
    74 * 3,
    0,
    0,
    0,
    21,
    0,
    0,
    20,
    0,
    0,
    19,
    0,
    0,
    18,
    0,
    0,
    17,
    0,
    0,
    16,
    0,
    0,
    35,
    0,
    0,
    34,
    0,
    0,
    33,
    0,
    0,
    32,
    0,
    0,
    31,
    0,
    0,
    30,
    0,
    0,
    29,
    0,
    0,
    28,
    0,
    0,
    27,
    0,
    0,
    26,
    0,
    0,
    25,
    0,
    0,
    24,
    0,
    0,
    23,
    0,
    0,
    22,
  ]);
  MPEG1.MACROBLOCK_TYPE_INTRA = new Int8Array([
    1 * 3,
    2 * 3,
    0,
    -1,
    3 * 3,
    0,
    0,
    0,
    1,
    0,
    0,
    17,
  ]);
  MPEG1.MACROBLOCK_TYPE_PREDICTIVE = new Int8Array([
    1 * 3,
    2 * 3,
    0,
    3 * 3,
    4 * 3,
    0,
    0,
    0,
    10,
    5 * 3,
    6 * 3,
    0,
    0,
    0,
    2,
    7 * 3,
    8 * 3,
    0,
    0,
    0,
    8,
    9 * 3,
    10 * 3,
    0,
    11 * 3,
    12 * 3,
    0,
    -1,
    13 * 3,
    0,
    0,
    0,
    18,
    0,
    0,
    26,
    0,
    0,
    1,
    0,
    0,
    17,
  ]);
  MPEG1.MACROBLOCK_TYPE_B = new Int8Array([
    1 * 3,
    2 * 3,
    0,
    3 * 3,
    5 * 3,
    0,
    4 * 3,
    6 * 3,
    0,
    8 * 3,
    7 * 3,
    0,
    0,
    0,
    12,
    9 * 3,
    10 * 3,
    0,
    0,
    0,
    14,
    13 * 3,
    14 * 3,
    0,
    12 * 3,
    11 * 3,
    0,
    0,
    0,
    4,
    0,
    0,
    6,
    18 * 3,
    16 * 3,
    0,
    15 * 3,
    17 * 3,
    0,
    0,
    0,
    8,
    0,
    0,
    10,
    -1,
    19 * 3,
    0,
    0,
    0,
    1,
    20 * 3,
    21 * 3,
    0,
    0,
    0,
    30,
    0,
    0,
    17,
    0,
    0,
    22,
    0,
    0,
    26,
  ]);
  MPEG1.MACROBLOCK_TYPE = [
    null,
    MPEG1.MACROBLOCK_TYPE_INTRA,
    MPEG1.MACROBLOCK_TYPE_PREDICTIVE,
    MPEG1.MACROBLOCK_TYPE_B,
  ];
  MPEG1.CODE_BLOCK_PATTERN = new Int16Array([
    2 * 3,
    1 * 3,
    0,
    3 * 3,
    6 * 3,
    0,
    4 * 3,
    5 * 3,
    0,
    8 * 3,
    11 * 3,
    0,
    12 * 3,
    13 * 3,
    0,
    9 * 3,
    7 * 3,
    0,
    10 * 3,
    14 * 3,
    0,
    20 * 3,
    19 * 3,
    0,
    18 * 3,
    16 * 3,
    0,
    23 * 3,
    17 * 3,
    0,
    27 * 3,
    25 * 3,
    0,
    21 * 3,
    28 * 3,
    0,
    15 * 3,
    22 * 3,
    0,
    24 * 3,
    26 * 3,
    0,
    0,
    0,
    60,
    35 * 3,
    40 * 3,
    0,
    44 * 3,
    48 * 3,
    0,
    38 * 3,
    36 * 3,
    0,
    42 * 3,
    47 * 3,
    0,
    29 * 3,
    31 * 3,
    0,
    39 * 3,
    32 * 3,
    0,
    0,
    0,
    32,
    45 * 3,
    46 * 3,
    0,
    33 * 3,
    41 * 3,
    0,
    43 * 3,
    34 * 3,
    0,
    0,
    0,
    4,
    30 * 3,
    37 * 3,
    0,
    0,
    0,
    8,
    0,
    0,
    16,
    0,
    0,
    44,
    50 * 3,
    56 * 3,
    0,
    0,
    0,
    28,
    0,
    0,
    52,
    0,
    0,
    62,
    61 * 3,
    59 * 3,
    0,
    52 * 3,
    60 * 3,
    0,
    0,
    0,
    1,
    55 * 3,
    54 * 3,
    0,
    0,
    0,
    61,
    0,
    0,
    56,
    57 * 3,
    58 * 3,
    0,
    0,
    0,
    2,
    0,
    0,
    40,
    51 * 3,
    62 * 3,
    0,
    0,
    0,
    48,
    64 * 3,
    63 * 3,
    0,
    49 * 3,
    53 * 3,
    0,
    0,
    0,
    20,
    0,
    0,
    12,
    80 * 3,
    83 * 3,
    0,
    0,
    0,
    63,
    77 * 3,
    75 * 3,
    0,
    65 * 3,
    73 * 3,
    0,
    84 * 3,
    66 * 3,
    0,
    0,
    0,
    24,
    0,
    0,
    36,
    0,
    0,
    3,
    69 * 3,
    87 * 3,
    0,
    81 * 3,
    79 * 3,
    0,
    68 * 3,
    71 * 3,
    0,
    70 * 3,
    78 * 3,
    0,
    67 * 3,
    76 * 3,
    0,
    72 * 3,
    74 * 3,
    0,
    86 * 3,
    85 * 3,
    0,
    88 * 3,
    82 * 3,
    0,
    -1,
    94 * 3,
    0,
    95 * 3,
    97 * 3,
    0,
    0,
    0,
    33,
    0,
    0,
    9,
    106 * 3,
    110 * 3,
    0,
    102 * 3,
    116 * 3,
    0,
    0,
    0,
    5,
    0,
    0,
    10,
    93 * 3,
    89 * 3,
    0,
    0,
    0,
    6,
    0,
    0,
    18,
    0,
    0,
    17,
    0,
    0,
    34,
    113 * 3,
    119 * 3,
    0,
    103 * 3,
    104 * 3,
    0,
    90 * 3,
    92 * 3,
    0,
    109 * 3,
    107 * 3,
    0,
    117 * 3,
    118 * 3,
    0,
    101 * 3,
    99 * 3,
    0,
    98 * 3,
    96 * 3,
    0,
    100 * 3,
    91 * 3,
    0,
    114 * 3,
    115 * 3,
    0,
    105 * 3,
    108 * 3,
    0,
    112 * 3,
    111 * 3,
    0,
    121 * 3,
    125 * 3,
    0,
    0,
    0,
    41,
    0,
    0,
    14,
    0,
    0,
    21,
    124 * 3,
    122 * 3,
    0,
    120 * 3,
    123 * 3,
    0,
    0,
    0,
    11,
    0,
    0,
    19,
    0,
    0,
    7,
    0,
    0,
    35,
    0,
    0,
    13,
    0,
    0,
    50,
    0,
    0,
    49,
    0,
    0,
    58,
    0,
    0,
    37,
    0,
    0,
    25,
    0,
    0,
    45,
    0,
    0,
    57,
    0,
    0,
    26,
    0,
    0,
    29,
    0,
    0,
    38,
    0,
    0,
    53,
    0,
    0,
    23,
    0,
    0,
    43,
    0,
    0,
    46,
    0,
    0,
    42,
    0,
    0,
    22,
    0,
    0,
    54,
    0,
    0,
    51,
    0,
    0,
    15,
    0,
    0,
    30,
    0,
    0,
    39,
    0,
    0,
    47,
    0,
    0,
    55,
    0,
    0,
    27,
    0,
    0,
    59,
    0,
    0,
    31,
  ]);
  MPEG1.MOTION = new Int16Array([
    1 * 3,
    2 * 3,
    0,
    4 * 3,
    3 * 3,
    0,
    0,
    0,
    0,
    6 * 3,
    5 * 3,
    0,
    8 * 3,
    7 * 3,
    0,
    0,
    0,
    -1,
    0,
    0,
    1,
    9 * 3,
    10 * 3,
    0,
    12 * 3,
    11 * 3,
    0,
    0,
    0,
    2,
    0,
    0,
    -2,
    14 * 3,
    15 * 3,
    0,
    16 * 3,
    13 * 3,
    0,
    20 * 3,
    18 * 3,
    0,
    0,
    0,
    3,
    0,
    0,
    -3,
    17 * 3,
    19 * 3,
    0,
    -1,
    23 * 3,
    0,
    27 * 3,
    25 * 3,
    0,
    26 * 3,
    21 * 3,
    0,
    24 * 3,
    22 * 3,
    0,
    32 * 3,
    28 * 3,
    0,
    29 * 3,
    31 * 3,
    0,
    -1,
    33 * 3,
    0,
    36 * 3,
    35 * 3,
    0,
    0,
    0,
    -4,
    30 * 3,
    34 * 3,
    0,
    0,
    0,
    4,
    0,
    0,
    -7,
    0,
    0,
    5,
    37 * 3,
    41 * 3,
    0,
    0,
    0,
    -5,
    0,
    0,
    7,
    38 * 3,
    40 * 3,
    0,
    42 * 3,
    39 * 3,
    0,
    0,
    0,
    -6,
    0,
    0,
    6,
    51 * 3,
    54 * 3,
    0,
    50 * 3,
    49 * 3,
    0,
    45 * 3,
    46 * 3,
    0,
    52 * 3,
    47 * 3,
    0,
    43 * 3,
    53 * 3,
    0,
    44 * 3,
    48 * 3,
    0,
    0,
    0,
    10,
    0,
    0,
    9,
    0,
    0,
    8,
    0,
    0,
    -8,
    57 * 3,
    66 * 3,
    0,
    0,
    0,
    -9,
    60 * 3,
    64 * 3,
    0,
    56 * 3,
    61 * 3,
    0,
    55 * 3,
    62 * 3,
    0,
    58 * 3,
    63 * 3,
    0,
    0,
    0,
    -10,
    59 * 3,
    65 * 3,
    0,
    0,
    0,
    12,
    0,
    0,
    16,
    0,
    0,
    13,
    0,
    0,
    14,
    0,
    0,
    11,
    0,
    0,
    15,
    0,
    0,
    -16,
    0,
    0,
    -12,
    0,
    0,
    -14,
    0,
    0,
    -15,
    0,
    0,
    -11,
    0,
    0,
    -13,
  ]);
  MPEG1.DCT_DC_SIZE_LUMINANCE = new Int8Array([
    2 * 3,
    1 * 3,
    0,
    6 * 3,
    5 * 3,
    0,
    3 * 3,
    4 * 3,
    0,
    0,
    0,
    1,
    0,
    0,
    2,
    9 * 3,
    8 * 3,
    0,
    7 * 3,
    10 * 3,
    0,
    0,
    0,
    0,
    12 * 3,
    11 * 3,
    0,
    0,
    0,
    4,
    0,
    0,
    3,
    13 * 3,
    14 * 3,
    0,
    0,
    0,
    5,
    0,
    0,
    6,
    16 * 3,
    15 * 3,
    0,
    17 * 3,
    -1,
    0,
    0,
    0,
    7,
    0,
    0,
    8,
  ]);
  MPEG1.DCT_DC_SIZE_CHROMINANCE = new Int8Array([
    2 * 3,
    1 * 3,
    0,
    4 * 3,
    3 * 3,
    0,
    6 * 3,
    5 * 3,
    0,
    8 * 3,
    7 * 3,
    0,
    0,
    0,
    2,
    0,
    0,
    1,
    0,
    0,
    0,
    10 * 3,
    9 * 3,
    0,
    0,
    0,
    3,
    12 * 3,
    11 * 3,
    0,
    0,
    0,
    4,
    14 * 3,
    13 * 3,
    0,
    0,
    0,
    5,
    16 * 3,
    15 * 3,
    0,
    0,
    0,
    6,
    17 * 3,
    -1,
    0,
    0,
    0,
    7,
    0,
    0,
    8,
  ]);
  MPEG1.DCT_COEFF = new Int32Array([
    1 * 3,
    2 * 3,
    0,
    4 * 3,
    3 * 3,
    0,
    0,
    0,
    1,
    7 * 3,
    8 * 3,
    0,
    6 * 3,
    5 * 3,
    0,
    13 * 3,
    9 * 3,
    0,
    11 * 3,
    10 * 3,
    0,
    14 * 3,
    12 * 3,
    0,
    0,
    0,
    257,
    20 * 3,
    22 * 3,
    0,
    18 * 3,
    21 * 3,
    0,
    16 * 3,
    19 * 3,
    0,
    0,
    0,
    513,
    17 * 3,
    15 * 3,
    0,
    0,
    0,
    2,
    0,
    0,
    3,
    27 * 3,
    25 * 3,
    0,
    29 * 3,
    31 * 3,
    0,
    24 * 3,
    26 * 3,
    0,
    32 * 3,
    30 * 3,
    0,
    0,
    0,
    1025,
    23 * 3,
    28 * 3,
    0,
    0,
    0,
    769,
    0,
    0,
    258,
    0,
    0,
    1793,
    0,
    0,
    65535,
    0,
    0,
    1537,
    37 * 3,
    36 * 3,
    0,
    0,
    0,
    1281,
    35 * 3,
    34 * 3,
    0,
    39 * 3,
    38 * 3,
    0,
    33 * 3,
    42 * 3,
    0,
    40 * 3,
    41 * 3,
    0,
    52 * 3,
    50 * 3,
    0,
    54 * 3,
    53 * 3,
    0,
    48 * 3,
    49 * 3,
    0,
    43 * 3,
    45 * 3,
    0,
    46 * 3,
    44 * 3,
    0,
    0,
    0,
    2049,
    0,
    0,
    4,
    0,
    0,
    514,
    0,
    0,
    2305,
    51 * 3,
    47 * 3,
    0,
    55 * 3,
    57 * 3,
    0,
    60 * 3,
    56 * 3,
    0,
    59 * 3,
    58 * 3,
    0,
    61 * 3,
    62 * 3,
    0,
    0,
    0,
    2561,
    0,
    0,
    3329,
    0,
    0,
    6,
    0,
    0,
    259,
    0,
    0,
    5,
    0,
    0,
    770,
    0,
    0,
    2817,
    0,
    0,
    3073,
    76 * 3,
    75 * 3,
    0,
    67 * 3,
    70 * 3,
    0,
    73 * 3,
    71 * 3,
    0,
    78 * 3,
    74 * 3,
    0,
    72 * 3,
    77 * 3,
    0,
    69 * 3,
    64 * 3,
    0,
    68 * 3,
    63 * 3,
    0,
    66 * 3,
    65 * 3,
    0,
    81 * 3,
    87 * 3,
    0,
    91 * 3,
    80 * 3,
    0,
    82 * 3,
    79 * 3,
    0,
    83 * 3,
    86 * 3,
    0,
    93 * 3,
    92 * 3,
    0,
    84 * 3,
    85 * 3,
    0,
    90 * 3,
    94 * 3,
    0,
    88 * 3,
    89 * 3,
    0,
    0,
    0,
    515,
    0,
    0,
    260,
    0,
    0,
    7,
    0,
    0,
    1026,
    0,
    0,
    1282,
    0,
    0,
    4097,
    0,
    0,
    3841,
    0,
    0,
    3585,
    105 * 3,
    107 * 3,
    0,
    111 * 3,
    114 * 3,
    0,
    104 * 3,
    97 * 3,
    0,
    125 * 3,
    119 * 3,
    0,
    96 * 3,
    98 * 3,
    0,
    -1,
    123 * 3,
    0,
    95 * 3,
    101 * 3,
    0,
    106 * 3,
    121 * 3,
    0,
    99 * 3,
    102 * 3,
    0,
    113 * 3,
    103 * 3,
    0,
    112 * 3,
    116 * 3,
    0,
    110 * 3,
    100 * 3,
    0,
    124 * 3,
    115 * 3,
    0,
    117 * 3,
    122 * 3,
    0,
    109 * 3,
    118 * 3,
    0,
    120 * 3,
    108 * 3,
    0,
    127 * 3,
    136 * 3,
    0,
    139 * 3,
    140 * 3,
    0,
    130 * 3,
    126 * 3,
    0,
    145 * 3,
    146 * 3,
    0,
    128 * 3,
    129 * 3,
    0,
    0,
    0,
    2050,
    132 * 3,
    134 * 3,
    0,
    155 * 3,
    154 * 3,
    0,
    0,
    0,
    8,
    137 * 3,
    133 * 3,
    0,
    143 * 3,
    144 * 3,
    0,
    151 * 3,
    138 * 3,
    0,
    142 * 3,
    141 * 3,
    0,
    0,
    0,
    10,
    0,
    0,
    9,
    0,
    0,
    11,
    0,
    0,
    5377,
    0,
    0,
    1538,
    0,
    0,
    771,
    0,
    0,
    5121,
    0,
    0,
    1794,
    0,
    0,
    4353,
    0,
    0,
    4609,
    0,
    0,
    4865,
    148 * 3,
    152 * 3,
    0,
    0,
    0,
    1027,
    153 * 3,
    150 * 3,
    0,
    0,
    0,
    261,
    131 * 3,
    135 * 3,
    0,
    0,
    0,
    516,
    149 * 3,
    147 * 3,
    0,
    172 * 3,
    173 * 3,
    0,
    162 * 3,
    158 * 3,
    0,
    170 * 3,
    161 * 3,
    0,
    168 * 3,
    166 * 3,
    0,
    157 * 3,
    179 * 3,
    0,
    169 * 3,
    167 * 3,
    0,
    174 * 3,
    171 * 3,
    0,
    178 * 3,
    177 * 3,
    0,
    156 * 3,
    159 * 3,
    0,
    164 * 3,
    165 * 3,
    0,
    183 * 3,
    182 * 3,
    0,
    175 * 3,
    176 * 3,
    0,
    0,
    0,
    263,
    0,
    0,
    2562,
    0,
    0,
    2306,
    0,
    0,
    5633,
    0,
    0,
    5889,
    0,
    0,
    6401,
    0,
    0,
    6145,
    0,
    0,
    1283,
    0,
    0,
    772,
    0,
    0,
    13,
    0,
    0,
    12,
    0,
    0,
    14,
    0,
    0,
    15,
    0,
    0,
    517,
    0,
    0,
    6657,
    0,
    0,
    262,
    180 * 3,
    181 * 3,
    0,
    160 * 3,
    163 * 3,
    0,
    196 * 3,
    199 * 3,
    0,
    0,
    0,
    27,
    203 * 3,
    185 * 3,
    0,
    202 * 3,
    201 * 3,
    0,
    0,
    0,
    19,
    0,
    0,
    22,
    197 * 3,
    207 * 3,
    0,
    0,
    0,
    18,
    191 * 3,
    192 * 3,
    0,
    188 * 3,
    190 * 3,
    0,
    0,
    0,
    20,
    184 * 3,
    194 * 3,
    0,
    0,
    0,
    21,
    186 * 3,
    193 * 3,
    0,
    0,
    0,
    23,
    204 * 3,
    198 * 3,
    0,
    0,
    0,
    25,
    0,
    0,
    24,
    200 * 3,
    205 * 3,
    0,
    0,
    0,
    31,
    0,
    0,
    30,
    0,
    0,
    28,
    0,
    0,
    29,
    0,
    0,
    26,
    0,
    0,
    17,
    0,
    0,
    16,
    189 * 3,
    206 * 3,
    0,
    187 * 3,
    195 * 3,
    0,
    218 * 3,
    211 * 3,
    0,
    0,
    0,
    37,
    215 * 3,
    216 * 3,
    0,
    0,
    0,
    36,
    210 * 3,
    212 * 3,
    0,
    0,
    0,
    34,
    213 * 3,
    209 * 3,
    0,
    221 * 3,
    222 * 3,
    0,
    219 * 3,
    208 * 3,
    0,
    217 * 3,
    214 * 3,
    0,
    223 * 3,
    220 * 3,
    0,
    0,
    0,
    35,
    0,
    0,
    267,
    0,
    0,
    40,
    0,
    0,
    268,
    0,
    0,
    266,
    0,
    0,
    32,
    0,
    0,
    264,
    0,
    0,
    265,
    0,
    0,
    38,
    0,
    0,
    269,
    0,
    0,
    270,
    0,
    0,
    33,
    0,
    0,
    39,
    0,
    0,
    7937,
    0,
    0,
    6913,
    0,
    0,
    7681,
    0,
    0,
    4098,
    0,
    0,
    7425,
    0,
    0,
    7169,
    0,
    0,
    271,
    0,
    0,
    274,
    0,
    0,
    273,
    0,
    0,
    272,
    0,
    0,
    1539,
    0,
    0,
    2818,
    0,
    0,
    3586,
    0,
    0,
    3330,
    0,
    0,
    3074,
    0,
    0,
    3842,
  ]);
  MPEG1.PICTURE_TYPE = { INTRA: 1, PREDICTIVE: 2, B: 3 };
  MPEG1.START = {
    SEQUENCE: 179,
    SLICE_FIRST: 1,
    SLICE_LAST: 175,
    PICTURE: 0,
    EXTENSION: 181,
    USER_DATA: 178,
  };
  return MPEG1;
})();
JSMpeg.Decoder.MPEG1VideoWASM = (function () {
  "use strict";
  var MPEG1WASM = function (options) {
    JSMpeg.Decoder.Base.call(this, options);
    this.onDecodeCallback = options.onVideoDecode;
    this.module = options.wasmModule;
    this.bufferSize = options.videoBufferSize || 512 * 1024;
    this.bufferMode = options.streaming
      ? JSMpeg.BitBuffer.MODE.EVICT
      : JSMpeg.BitBuffer.MODE.EXPAND;
    this.decodeFirstFrame = options.decodeFirstFrame !== false;
    this.hasSequenceHeader = false;
  };
  MPEG1WASM.prototype = Object.create(JSMpeg.Decoder.Base.prototype);
  MPEG1WASM.prototype.constructor = MPEG1WASM;
  MPEG1WASM.prototype.initializeWasmDecoder = function () {
    if (!this.module.instance) {
      console.warn("JSMpeg: WASM module not compiled yet");
      return;
    }
    this.instance = this.module.instance;
    this.functions = this.module.instance.exports;
    this.decoder = this.functions._mpeg1_decoder_create(
      this.bufferSize,
      this.bufferMode
    );
  };
  MPEG1WASM.prototype.destroy = function () {
    if (!this.decoder) {
      return;
    }
    this.functions._mpeg1_decoder_destroy(this.decoder);
  };
  MPEG1WASM.prototype.bufferGetIndex = function () {
    if (!this.decoder) {
      return;
    }
    return this.functions._mpeg1_decoder_get_index(this.decoder);
  };
  MPEG1WASM.prototype.bufferSetIndex = function (index) {
    if (!this.decoder) {
      return;
    }
    this.functions._mpeg1_decoder_set_index(this.decoder, index);
  };
  MPEG1WASM.prototype.bufferWrite = function (buffers) {
    if (!this.decoder) {
      this.initializeWasmDecoder();
    }
    var totalLength = 0;
    for (var i = 0; i < buffers.length; i++) {
      totalLength += buffers[i].length;
    }
    var ptr = this.functions._mpeg1_decoder_get_write_ptr(
      this.decoder,
      totalLength
    );
    for (var i = 0; i < buffers.length; i++) {
      this.instance.heapU8.set(buffers[i], ptr);
      ptr += buffers[i].length;
    }
    this.functions._mpeg1_decoder_did_write(this.decoder, totalLength);
    return totalLength;
  };
  MPEG1WASM.prototype.write = function (pts, buffers) {
    JSMpeg.Decoder.Base.prototype.write.call(this, pts, buffers);
    if (
      !this.hasSequenceHeader &&
      this.functions._mpeg1_decoder_has_sequence_header(this.decoder)
    ) {
      this.loadSequnceHeader();
    }
  };
  MPEG1WASM.prototype.loadSequnceHeader = function () {
    this.hasSequenceHeader = true;
    this.frameRate = this.functions._mpeg1_decoder_get_frame_rate(this.decoder);
    this.codedSize = this.functions._mpeg1_decoder_get_coded_size(this.decoder);
    if (this.destination) {
      var w = this.functions._mpeg1_decoder_get_width(this.decoder);
      var h = this.functions._mpeg1_decoder_get_height(this.decoder);
      this.destination.resize(w, h);
    }
    if (this.decodeFirstFrame) {
      this.decode();
    }
  };
  MPEG1WASM.prototype.decode = function () {
    var startTime = JSMpeg.Now();
    if (!this.decoder) {
      return false;
    }
    var didDecode = this.functions._mpeg1_decoder_decode(this.decoder);
    if (!didDecode) {
      return false;
    }
    if (this.destination) {
      var ptrY = this.functions._mpeg1_decoder_get_y_ptr(this.decoder),
        ptrCr = this.functions._mpeg1_decoder_get_cr_ptr(this.decoder),
        ptrCb = this.functions._mpeg1_decoder_get_cb_ptr(this.decoder);
      var dy = this.instance.heapU8.subarray(ptrY, ptrY + this.codedSize);
      var dcr = this.instance.heapU8.subarray(
        ptrCr,
        ptrCr + (this.codedSize >> 2)
      );
      var dcb = this.instance.heapU8.subarray(
        ptrCb,
        ptrCb + (this.codedSize >> 2)
      );
      this.destination.render(dy, dcr, dcb, false);
    }
    this.advanceDecodedTime(1 / this.frameRate);
    var elapsedTime = JSMpeg.Now() - startTime;
    if (this.onDecodeCallback) {
      this.onDecodeCallback(this, elapsedTime);
    }
    return true;
  };
  return MPEG1WASM;
})();
JSMpeg.Decoder.MP2Audio = (function () {
  "use strict";
  var MP2 = function (options) {
    JSMpeg.Decoder.Base.call(this, options);
    this.onDecodeCallback = options.onAudioDecode;
    var bufferSize = options.audioBufferSize || 128 * 1024;
    var bufferMode = options.streaming
      ? JSMpeg.BitBuffer.MODE.EVICT
      : JSMpeg.BitBuffer.MODE.EXPAND;
    this.bits = new JSMpeg.BitBuffer(bufferSize, bufferMode);
    this.left = new Float32Array(1152);
    this.right = new Float32Array(1152);
    this.sampleRate = 44100;
    this.D = new Float32Array(1024);
    this.D.set(MP2.SYNTHESIS_WINDOW, 0);
    this.D.set(MP2.SYNTHESIS_WINDOW, 512);
    this.V = new Float32Array(1024);
    this.U = new Int32Array(32);
    this.VPos = 0;
    this.allocation = [new Array(32), new Array(32)];
    this.scaleFactorInfo = [new Uint8Array(32), new Uint8Array(32)];
    this.scaleFactor = [new Array(32), new Array(32)];
    this.sample = [new Array(32), new Array(32)];
    for (var j = 0; j < 2; j++) {
      for (var i = 0; i < 32; i++) {
        this.scaleFactor[j][i] = [0, 0, 0];
        this.sample[j][i] = [0, 0, 0];
      }
    }
  };
  MP2.prototype = Object.create(JSMpeg.Decoder.Base.prototype);
  MP2.prototype.constructor = MP2;
  MP2.prototype.decode = function () {
    var startTime = JSMpeg.Now();
    var pos = this.bits.index >> 3;
    if (pos >= this.bits.byteLength) {
      return false;
    }
    var decoded = this.decodeFrame(this.left, this.right);
    this.bits.index = (pos + decoded) << 3;
    if (!decoded) {
      return false;
    }
    if (this.destination) {
      this.destination.play(this.sampleRate, this.left, this.right);
    }
    this.advanceDecodedTime(this.left.length / this.sampleRate);
    var elapsedTime = JSMpeg.Now() - startTime;
    if (this.onDecodeCallback) {
      this.onDecodeCallback(this, elapsedTime);
    }
    return true;
  };
  MP2.prototype.getCurrentTime = function () {
    var enqueuedTime = this.destination ? this.destination.enqueuedTime : 0;
    return this.decodedTime - enqueuedTime;
  };
  MP2.prototype.decodeFrame = function (left, right) {
    var sync = this.bits.read(11),
      version = this.bits.read(2),
      layer = this.bits.read(2),
      hasCRC = !this.bits.read(1);
    if (
      sync !== MP2.FRAME_SYNC ||
      version !== MP2.VERSION.MPEG_1 ||
      layer !== MP2.LAYER.II
    ) {
      return 0;
    }
    var bitrateIndex = this.bits.read(4) - 1;
    if (bitrateIndex > 13) {
      return 0;
    }
    var sampleRateIndex = this.bits.read(2);
    var sampleRate = MP2.SAMPLE_RATE[sampleRateIndex];
    if (sampleRateIndex === 3) {
      return 0;
    }
    if (version === MP2.VERSION.MPEG_2) {
      sampleRateIndex += 4;
      bitrateIndex += 14;
    }
    var padding = this.bits.read(1),
      privat = this.bits.read(1),
      mode = this.bits.read(2);
    var bound = 0;
    if (mode === MP2.MODE.JOINT_STEREO) {
      bound = (this.bits.read(2) + 1) << 2;
    } else {
      this.bits.skip(2);
      bound = mode === MP2.MODE.MONO ? 0 : 32;
    }
    this.bits.skip(4);
    if (hasCRC) {
      this.bits.skip(16);
    }
    var bitrate = MP2.BIT_RATE[bitrateIndex],
      sampleRate = MP2.SAMPLE_RATE[sampleRateIndex],
      frameSize = ((144e3 * bitrate) / sampleRate + padding) | 0;
    var tab3 = 0;
    var sblimit = 0;
    if (version === MP2.VERSION.MPEG_2) {
      tab3 = 2;
      sblimit = 30;
    } else {
      var tab1 = mode === MP2.MODE.MONO ? 0 : 1;
      var tab2 = MP2.QUANT_LUT_STEP_1[tab1][bitrateIndex];
      tab3 = MP2.QUANT_LUT_STEP_2[tab2][sampleRateIndex];
      sblimit = tab3 & 63;
      tab3 >>= 6;
    }
    if (bound > sblimit) {
      bound = sblimit;
    }
    for (var sb = 0; sb < bound; sb++) {
      this.allocation[0][sb] = this.readAllocation(sb, tab3);
      this.allocation[1][sb] = this.readAllocation(sb, tab3);
    }
    for (var sb = bound; sb < sblimit; sb++) {
      this.allocation[0][sb] = this.allocation[1][sb] = this.readAllocation(
        sb,
        tab3
      );
    }
    var channels = mode === MP2.MODE.MONO ? 1 : 2;
    for (var sb = 0; sb < sblimit; sb++) {
      for (ch = 0; ch < channels; ch++) {
        if (this.allocation[ch][sb]) {
          this.scaleFactorInfo[ch][sb] = this.bits.read(2);
        }
      }
      if (mode === MP2.MODE.MONO) {
        this.scaleFactorInfo[1][sb] = this.scaleFactorInfo[0][sb];
      }
    }
    for (var sb = 0; sb < sblimit; sb++) {
      for (var ch = 0; ch < channels; ch++) {
        if (this.allocation[ch][sb]) {
          var sf = this.scaleFactor[ch][sb];
          switch (this.scaleFactorInfo[ch][sb]) {
            case 0:
              sf[0] = this.bits.read(6);
              sf[1] = this.bits.read(6);
              sf[2] = this.bits.read(6);
              break;
            case 1:
              sf[0] = sf[1] = this.bits.read(6);
              sf[2] = this.bits.read(6);
              break;
            case 2:
              sf[0] = sf[1] = sf[2] = this.bits.read(6);
              break;
            case 3:
              sf[0] = this.bits.read(6);
              sf[1] = sf[2] = this.bits.read(6);
              break;
          }
        }
      }
      if (mode === MP2.MODE.MONO) {
        this.scaleFactor[1][sb][0] = this.scaleFactor[0][sb][0];
        this.scaleFactor[1][sb][1] = this.scaleFactor[0][sb][1];
        this.scaleFactor[1][sb][2] = this.scaleFactor[0][sb][2];
      }
    }
    var outPos = 0;
    for (var part = 0; part < 3; part++) {
      for (var granule = 0; granule < 4; granule++) {
        for (var sb = 0; sb < bound; sb++) {
          this.readSamples(0, sb, part);
          this.readSamples(1, sb, part);
        }
        for (var sb = bound; sb < sblimit; sb++) {
          this.readSamples(0, sb, part);
          this.sample[1][sb][0] = this.sample[0][sb][0];
          this.sample[1][sb][1] = this.sample[0][sb][1];
          this.sample[1][sb][2] = this.sample[0][sb][2];
        }
        for (var sb = sblimit; sb < 32; sb++) {
          this.sample[0][sb][0] = 0;
          this.sample[0][sb][1] = 0;
          this.sample[0][sb][2] = 0;
          this.sample[1][sb][0] = 0;
          this.sample[1][sb][1] = 0;
          this.sample[1][sb][2] = 0;
        }
        for (var p = 0; p < 3; p++) {
          this.VPos = (this.VPos - 64) & 1023;
          for (var ch = 0; ch < 2; ch++) {
            MP2.MatrixTransform(this.sample[ch], p, this.V, this.VPos);
            JSMpeg.Fill(this.U, 0);
            var dIndex = 512 - (this.VPos >> 1);
            var vIndex = this.VPos % 128 >> 1;
            while (vIndex < 1024) {
              for (var i = 0; i < 32; ++i) {
                this.U[i] += this.D[dIndex++] * this.V[vIndex++];
              }
              vIndex += 128 - 32;
              dIndex += 64 - 32;
            }
            vIndex = 128 - 32 + 1024 - vIndex;
            dIndex -= 512 - 32;
            while (vIndex < 1024) {
              for (var i = 0; i < 32; ++i) {
                this.U[i] += this.D[dIndex++] * this.V[vIndex++];
              }
              vIndex += 128 - 32;
              dIndex += 64 - 32;
            }
            var outChannel = ch === 0 ? left : right;
            for (var j = 0; j < 32; j++) {
              outChannel[outPos + j] = this.U[j] / 2147418112;
            }
          }
          outPos += 32;
        }
      }
    }
    this.sampleRate = sampleRate;
    return frameSize;
  };
  MP2.prototype.readAllocation = function (sb, tab3) {
    var tab4 = MP2.QUANT_LUT_STEP_3[tab3][sb];
    var qtab = MP2.QUANT_LUT_STEP4[tab4 & 15][this.bits.read(tab4 >> 4)];
    return qtab ? MP2.QUANT_TAB[qtab - 1] : 0;
  };
  MP2.prototype.readSamples = function (ch, sb, part) {
    var q = this.allocation[ch][sb],
      sf = this.scaleFactor[ch][sb][part],
      sample = this.sample[ch][sb],
      val = 0;
    if (!q) {
      sample[0] = sample[1] = sample[2] = 0;
      return;
    }
    if (sf === 63) {
      sf = 0;
    } else {
      var shift = (sf / 3) | 0;
      sf = (MP2.SCALEFACTOR_BASE[sf % 3] + ((1 << shift) >> 1)) >> shift;
    }
    var adj = q.levels;
    if (q.group) {
      val = this.bits.read(q.bits);
      sample[0] = val % adj;
      val = (val / adj) | 0;
      sample[1] = val % adj;
      sample[2] = (val / adj) | 0;
    } else {
      sample[0] = this.bits.read(q.bits);
      sample[1] = this.bits.read(q.bits);
      sample[2] = this.bits.read(q.bits);
    }
    var scale = (65536 / (adj + 1)) | 0;
    adj = ((adj + 1) >> 1) - 1;
    val = (adj - sample[0]) * scale;
    sample[0] = (val * (sf >> 12) + ((val * (sf & 4095) + 2048) >> 12)) >> 12;
    val = (adj - sample[1]) * scale;
    sample[1] = (val * (sf >> 12) + ((val * (sf & 4095) + 2048) >> 12)) >> 12;
    val = (adj - sample[2]) * scale;
    sample[2] = (val * (sf >> 12) + ((val * (sf & 4095) + 2048) >> 12)) >> 12;
  };
  MP2.MatrixTransform = function (s, ss, d, dp) {
    var t01,
      t02,
      t03,
      t04,
      t05,
      t06,
      t07,
      t08,
      t09,
      t10,
      t11,
      t12,
      t13,
      t14,
      t15,
      t16,
      t17,
      t18,
      t19,
      t20,
      t21,
      t22,
      t23,
      t24,
      t25,
      t26,
      t27,
      t28,
      t29,
      t30,
      t31,
      t32,
      t33;
    t01 = s[0][ss] + s[31][ss];
    t02 = (s[0][ss] - s[31][ss]) * 0.500602998235;
    t03 = s[1][ss] + s[30][ss];
    t04 = (s[1][ss] - s[30][ss]) * 0.505470959898;
    t05 = s[2][ss] + s[29][ss];
    t06 = (s[2][ss] - s[29][ss]) * 0.515447309923;
    t07 = s[3][ss] + s[28][ss];
    t08 = (s[3][ss] - s[28][ss]) * 0.53104259109;
    t09 = s[4][ss] + s[27][ss];
    t10 = (s[4][ss] - s[27][ss]) * 0.553103896034;
    t11 = s[5][ss] + s[26][ss];
    t12 = (s[5][ss] - s[26][ss]) * 0.582934968206;
    t13 = s[6][ss] + s[25][ss];
    t14 = (s[6][ss] - s[25][ss]) * 0.622504123036;
    t15 = s[7][ss] + s[24][ss];
    t16 = (s[7][ss] - s[24][ss]) * 0.674808341455;
    t17 = s[8][ss] + s[23][ss];
    t18 = (s[8][ss] - s[23][ss]) * 0.744536271002;
    t19 = s[9][ss] + s[22][ss];
    t20 = (s[9][ss] - s[22][ss]) * 0.839349645416;
    t21 = s[10][ss] + s[21][ss];
    t22 = (s[10][ss] - s[21][ss]) * 0.972568237862;
    t23 = s[11][ss] + s[20][ss];
    t24 = (s[11][ss] - s[20][ss]) * 1.16943993343;
    t25 = s[12][ss] + s[19][ss];
    t26 = (s[12][ss] - s[19][ss]) * 1.48416461631;
    t27 = s[13][ss] + s[18][ss];
    t28 = (s[13][ss] - s[18][ss]) * 2.05778100995;
    t29 = s[14][ss] + s[17][ss];
    t30 = (s[14][ss] - s[17][ss]) * 3.40760841847;
    t31 = s[15][ss] + s[16][ss];
    t32 = (s[15][ss] - s[16][ss]) * 10.1900081235;
    t33 = t01 + t31;
    t31 = (t01 - t31) * 0.502419286188;
    t01 = t03 + t29;
    t29 = (t03 - t29) * 0.52249861494;
    t03 = t05 + t27;
    t27 = (t05 - t27) * 0.566944034816;
    t05 = t07 + t25;
    t25 = (t07 - t25) * 0.64682178336;
    t07 = t09 + t23;
    t23 = (t09 - t23) * 0.788154623451;
    t09 = t11 + t21;
    t21 = (t11 - t21) * 1.06067768599;
    t11 = t13 + t19;
    t19 = (t13 - t19) * 1.72244709824;
    t13 = t15 + t17;
    t17 = (t15 - t17) * 5.10114861869;
    t15 = t33 + t13;
    t13 = (t33 - t13) * 0.509795579104;
    t33 = t01 + t11;
    t01 = (t01 - t11) * 0.601344886935;
    t11 = t03 + t09;
    t09 = (t03 - t09) * 0.899976223136;
    t03 = t05 + t07;
    t07 = (t05 - t07) * 2.56291544774;
    t05 = t15 + t03;
    t15 = (t15 - t03) * 0.541196100146;
    t03 = t33 + t11;
    t11 = (t33 - t11) * 1.30656296488;
    t33 = t05 + t03;
    t05 = (t05 - t03) * 0.707106781187;
    t03 = t15 + t11;
    t15 = (t15 - t11) * 0.707106781187;
    t03 += t15;
    t11 = t13 + t07;
    t13 = (t13 - t07) * 0.541196100146;
    t07 = t01 + t09;
    t09 = (t01 - t09) * 1.30656296488;
    t01 = t11 + t07;
    t07 = (t11 - t07) * 0.707106781187;
    t11 = t13 + t09;
    t13 = (t13 - t09) * 0.707106781187;
    t11 += t13;
    t01 += t11;
    t11 += t07;
    t07 += t13;
    t09 = t31 + t17;
    t31 = (t31 - t17) * 0.509795579104;
    t17 = t29 + t19;
    t29 = (t29 - t19) * 0.601344886935;
    t19 = t27 + t21;
    t21 = (t27 - t21) * 0.899976223136;
    t27 = t25 + t23;
    t23 = (t25 - t23) * 2.56291544774;
    t25 = t09 + t27;
    t09 = (t09 - t27) * 0.541196100146;
    t27 = t17 + t19;
    t19 = (t17 - t19) * 1.30656296488;
    t17 = t25 + t27;
    t27 = (t25 - t27) * 0.707106781187;
    t25 = t09 + t19;
    t19 = (t09 - t19) * 0.707106781187;
    t25 += t19;
    t09 = t31 + t23;
    t31 = (t31 - t23) * 0.541196100146;
    t23 = t29 + t21;
    t21 = (t29 - t21) * 1.30656296488;
    t29 = t09 + t23;
    t23 = (t09 - t23) * 0.707106781187;
    t09 = t31 + t21;
    t31 = (t31 - t21) * 0.707106781187;
    t09 += t31;
    t29 += t09;
    t09 += t23;
    t23 += t31;
    t17 += t29;
    t29 += t25;
    t25 += t09;
    t09 += t27;
    t27 += t23;
    t23 += t19;
    t19 += t31;
    t21 = t02 + t32;
    t02 = (t02 - t32) * 0.502419286188;
    t32 = t04 + t30;
    t04 = (t04 - t30) * 0.52249861494;
    t30 = t06 + t28;
    t28 = (t06 - t28) * 0.566944034816;
    t06 = t08 + t26;
    t08 = (t08 - t26) * 0.64682178336;
    t26 = t10 + t24;
    t10 = (t10 - t24) * 0.788154623451;
    t24 = t12 + t22;
    t22 = (t12 - t22) * 1.06067768599;
    t12 = t14 + t20;
    t20 = (t14 - t20) * 1.72244709824;
    t14 = t16 + t18;
    t16 = (t16 - t18) * 5.10114861869;
    t18 = t21 + t14;
    t14 = (t21 - t14) * 0.509795579104;
    t21 = t32 + t12;
    t32 = (t32 - t12) * 0.601344886935;
    t12 = t30 + t24;
    t24 = (t30 - t24) * 0.899976223136;
    t30 = t06 + t26;
    t26 = (t06 - t26) * 2.56291544774;
    t06 = t18 + t30;
    t18 = (t18 - t30) * 0.541196100146;
    t30 = t21 + t12;
    t12 = (t21 - t12) * 1.30656296488;
    t21 = t06 + t30;
    t30 = (t06 - t30) * 0.707106781187;
    t06 = t18 + t12;
    t12 = (t18 - t12) * 0.707106781187;
    t06 += t12;
    t18 = t14 + t26;
    t26 = (t14 - t26) * 0.541196100146;
    t14 = t32 + t24;
    t24 = (t32 - t24) * 1.30656296488;
    t32 = t18 + t14;
    t14 = (t18 - t14) * 0.707106781187;
    t18 = t26 + t24;
    t24 = (t26 - t24) * 0.707106781187;
    t18 += t24;
    t32 += t18;
    t18 += t14;
    t26 = t14 + t24;
    t14 = t02 + t16;
    t02 = (t02 - t16) * 0.509795579104;
    t16 = t04 + t20;
    t04 = (t04 - t20) * 0.601344886935;
    t20 = t28 + t22;
    t22 = (t28 - t22) * 0.899976223136;
    t28 = t08 + t10;
    t10 = (t08 - t10) * 2.56291544774;
    t08 = t14 + t28;
    t14 = (t14 - t28) * 0.541196100146;
    t28 = t16 + t20;
    t20 = (t16 - t20) * 1.30656296488;
    t16 = t08 + t28;
    t28 = (t08 - t28) * 0.707106781187;
    t08 = t14 + t20;
    t20 = (t14 - t20) * 0.707106781187;
    t08 += t20;
    t14 = t02 + t10;
    t02 = (t02 - t10) * 0.541196100146;
    t10 = t04 + t22;
    t22 = (t04 - t22) * 1.30656296488;
    t04 = t14 + t10;
    t10 = (t14 - t10) * 0.707106781187;
    t14 = t02 + t22;
    t02 = (t02 - t22) * 0.707106781187;
    t14 += t02;
    t04 += t14;
    t14 += t10;
    t10 += t02;
    t16 += t04;
    t04 += t08;
    t08 += t14;
    t14 += t28;
    t28 += t10;
    t10 += t20;
    t20 += t02;
    t21 += t16;
    t16 += t32;
    t32 += t04;
    t04 += t06;
    t06 += t08;
    t08 += t18;
    t18 += t14;
    t14 += t30;
    t30 += t28;
    t28 += t26;
    t26 += t10;
    t10 += t12;
    t12 += t20;
    t20 += t24;
    t24 += t02;
    d[dp + 48] = -t33;
    d[dp + 49] = d[dp + 47] = -t21;
    d[dp + 50] = d[dp + 46] = -t17;
    d[dp + 51] = d[dp + 45] = -t16;
    d[dp + 52] = d[dp + 44] = -t01;
    d[dp + 53] = d[dp + 43] = -t32;
    d[dp + 54] = d[dp + 42] = -t29;
    d[dp + 55] = d[dp + 41] = -t04;
    d[dp + 56] = d[dp + 40] = -t03;
    d[dp + 57] = d[dp + 39] = -t06;
    d[dp + 58] = d[dp + 38] = -t25;
    d[dp + 59] = d[dp + 37] = -t08;
    d[dp + 60] = d[dp + 36] = -t11;
    d[dp + 61] = d[dp + 35] = -t18;
    d[dp + 62] = d[dp + 34] = -t09;
    d[dp + 63] = d[dp + 33] = -t14;
    d[dp + 32] = -t05;
    d[dp + 0] = t05;
    d[dp + 31] = -t30;
    d[dp + 1] = t30;
    d[dp + 30] = -t27;
    d[dp + 2] = t27;
    d[dp + 29] = -t28;
    d[dp + 3] = t28;
    d[dp + 28] = -t07;
    d[dp + 4] = t07;
    d[dp + 27] = -t26;
    d[dp + 5] = t26;
    d[dp + 26] = -t23;
    d[dp + 6] = t23;

    d[dp + 25] = -t10;
    d[dp + 7] = t10;
    d[dp + 24] = -t15;
    d[dp + 8] = t15;
    d[dp + 23] = -t12;
    d[dp + 9] = t12;
    d[dp + 22] = -t19;
    d[dp + 10] = t19;
    d[dp + 21] = -t20;
    d[dp + 11] = t20;
    d[dp + 20] = -t13;
    d[dp + 12] = t13;
    d[dp + 19] = -t24;
    d[dp + 13] = t24;
    d[dp + 18] = -t31;
    d[dp + 14] = t31;
    d[dp + 17] = -t02;
    d[dp + 15] = t02;
    d[dp + 16] = 0;
  };
  MP2.FRAME_SYNC = 2047;
  MP2.VERSION = { MPEG_2_5: 0, MPEG_2: 2, MPEG_1: 3 };
  MP2.LAYER = { III: 1, II: 2, I: 3 };
  MP2.MODE = { STEREO: 0, JOINT_STEREO: 1, DUAL_CHANNEL: 2, MONO: 3 };
  MP2.SAMPLE_RATE = new Uint16Array([
    44100, 48e3, 32e3, 0, 22050, 24e3, 16e3, 0,
  ]);
  MP2.BIT_RATE = new Uint16Array([
    32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 8, 16, 24,
    32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
  ]);
  MP2.SCALEFACTOR_BASE = new Uint32Array([33554432, 26632170, 21137968]);
  MP2.SYNTHESIS_WINDOW = new Float32Array([
    0, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -1, -1, -1, -1, -1.5, -1.5, -2, -2,
    -2.5, -2.5, -3, -3.5, -3.5, -4, -4.5, -5, -5.5, -6.5, -7, -8, -8.5, -9.5,
    -10.5, -12, -13, -14.5, -15.5, -17.5, -19, -20.5, -22.5, -24.5, -26.5, -29,
    -31.5, -34, -36.5, -39.5, -42.5, -45.5, -48.5, -52, -55.5, -58.5, -62.5,
    -66, -69.5, -73.5, -77, -80.5, -84.5, -88, -91.5, -95, -98, -101, -104,
    106.5, 109, 111, 112.5, 113.5, 114, 114, 113.5, 112, 110.5, 107.5, 104, 100,
    94.5, 88.5, 81.5, 73, 63.5, 53, 41.5, 28.5, 14.5, -1, -18, -36, -55.5,
    -76.5, -98.5, -122, -147, -173.5, -200.5, -229.5, -259.5, -290.5, -322.5,
    -355.5, -389.5, -424, -459.5, -495.5, -532, -568.5, -605, -641.5, -678,
    -714, -749, -783.5, -817, -849, -879.5, -908.5, -935, -959.5, -981, -1000.5,
    -1016, -1028.5, -1037.5, -1042.5, -1043.5, -1040, -1031.5, 1018.5, 1e3, 976,
    946.5, 911, 869.5, 822, 767.5, 707, 640, 565.5, 485, 397, 302.5, 201, 92.5,
    -22.5, -144, -272.5, -407, -547.5, -694, -846, -1003, -1165, -1331.5, -1502,
    -1675.5, -1852.5, -2031.5, -2212.5, -2394, -2576.5, -2758.5, -2939.5,
    -3118.5, -3294.5, -3467.5, -3635.5, -3798.5, -3955, -4104.5, -4245.5,
    -4377.5, -4499, -4609.5, -4708, -4792.5, -4863.5, -4919, -4958, -4979.5,
    -4983, -4967.5, -4931.5, -4875, -4796, -4694.5, -4569.5, -4420, -4246,
    -4046, -3820, -3567, 3287, 2979.5, 2644, 2280.5, 1888, 1467.5, 1018.5, 541,
    35, -499, -1061, -1650, -2266.5, -2909, -3577, -4270, -4987.5, -5727.5,
    -6490, -7274, -8077.5, -8899.5, -9739, -10594.5, -11464.5, -12347, -13241,
    -14144.5, -15056, -15973.5, -16895.5, -17820, -18744.5, -19668, -20588,
    -21503, -22410.5, -23308.5, -24195, -25068.5, -25926.5, -26767, -27589,
    -28389, -29166.5, -29919, -30644.5, -31342, -32009.5, -32645, -33247,
    -33814.5, -34346, -34839.5, -35295, -35710, -36084.5, -36417.5, -36707.5,
    -36954, -37156.5, -37315, -37428, -37496, 37519, 37496, 37428, 37315,
    37156.5, 36954, 36707.5, 36417.5, 36084.5, 35710, 35295, 34839.5, 34346,
    33814.5, 33247, 32645, 32009.5, 31342, 30644.5, 29919, 29166.5, 28389,
    27589, 26767, 25926.5, 25068.5, 24195, 23308.5, 22410.5, 21503, 20588,
    19668, 18744.5, 17820, 16895.5, 15973.5, 15056, 14144.5, 13241, 12347,
    11464.5, 10594.5, 9739, 8899.5, 8077.5, 7274, 6490, 5727.5, 4987.5, 4270,
    3577, 2909, 2266.5, 1650, 1061, 499, -35, -541, -1018.5, -1467.5, -1888,
    -2280.5, -2644, -2979.5, 3287, 3567, 3820, 4046, 4246, 4420, 4569.5, 4694.5,
    4796, 4875, 4931.5, 4967.5, 4983, 4979.5, 4958, 4919, 4863.5, 4792.5, 4708,
    4609.5, 4499, 4377.5, 4245.5, 4104.5, 3955, 3798.5, 3635.5, 3467.5, 3294.5,
    3118.5, 2939.5, 2758.5, 2576.5, 2394, 2212.5, 2031.5, 1852.5, 1675.5, 1502,
    1331.5, 1165, 1003, 846, 694, 547.5, 407, 272.5, 144, 22.5, -92.5, -201,
    -302.5, -397, -485, -565.5, -640, -707, -767.5, -822, -869.5, -911, -946.5,
    -976, -1e3, 1018.5, 1031.5, 1040, 1043.5, 1042.5, 1037.5, 1028.5, 1016,
    1000.5, 981, 959.5, 935, 908.5, 879.5, 849, 817, 783.5, 749, 714, 678,
    641.5, 605, 568.5, 532, 495.5, 459.5, 424, 389.5, 355.5, 322.5, 290.5,
    259.5, 229.5, 200.5, 173.5, 147, 122, 98.5, 76.5, 55.5, 36, 18, 1, -14.5,
    -28.5, -41.5, -53, -63.5, -73, -81.5, -88.5, -94.5, -100, -104, -107.5,
    -110.5, -112, -113.5, -114, -114, -113.5, -112.5, -111, -109, 106.5, 104,
    101, 98, 95, 91.5, 88, 84.5, 80.5, 77, 73.5, 69.5, 66, 62.5, 58.5, 55.5, 52,
    48.5, 45.5, 42.5, 39.5, 36.5, 34, 31.5, 29, 26.5, 24.5, 22.5, 20.5, 19,
    17.5, 15.5, 14.5, 13, 12, 10.5, 9.5, 8.5, 8, 7, 6.5, 5.5, 5, 4.5, 4, 3.5,
    3.5, 3, 2.5, 2.5, 2, 2, 1.5, 1.5, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
  ]);
  MP2.QUANT_LUT_STEP_1 = [
    [0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    [0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 2],
  ];
  MP2.QUANT_TAB = { A: 27 | 64, B: 30 | 64, C: 8, D: 12 };
  MP2.QUANT_LUT_STEP_2 = [
    [MP2.QUANT_TAB.C, MP2.QUANT_TAB.C, MP2.QUANT_TAB.D],
    [MP2.QUANT_TAB.A, MP2.QUANT_TAB.A, MP2.QUANT_TAB.A],
    [MP2.QUANT_TAB.B, MP2.QUANT_TAB.A, MP2.QUANT_TAB.B],
  ];
  MP2.QUANT_LUT_STEP_3 = [
    [68, 68, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52],
    [
      67, 67, 67, 66, 66, 66, 66, 66, 66, 66, 66, 49, 49, 49, 49, 49, 49, 49,
      49, 49, 49, 49, 49, 32, 32, 32, 32, 32, 32, 32,
    ],
    [
      69, 69, 69, 69, 52, 52, 52, 52, 52, 52, 52, 36, 36, 36, 36, 36, 36, 36,
      36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36,
    ],
  ];
  MP2.QUANT_LUT_STEP4 = [
    [0, 1, 2, 17],
    [0, 1, 2, 3, 4, 5, 6, 17],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17],
    [0, 1, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
    [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  ];
  MP2.QUANT_TAB = [
    { levels: 3, group: 1, bits: 5 },
    { levels: 5, group: 1, bits: 7 },
    { levels: 7, group: 0, bits: 3 },
    { levels: 9, group: 1, bits: 10 },
    { levels: 15, group: 0, bits: 4 },
    { levels: 31, group: 0, bits: 5 },
    { levels: 63, group: 0, bits: 6 },
    { levels: 127, group: 0, bits: 7 },
    { levels: 255, group: 0, bits: 8 },
    { levels: 511, group: 0, bits: 9 },
    { levels: 1023, group: 0, bits: 10 },
    { levels: 2047, group: 0, bits: 11 },
    { levels: 4095, group: 0, bits: 12 },
    { levels: 8191, group: 0, bits: 13 },
    { levels: 16383, group: 0, bits: 14 },
    { levels: 32767, group: 0, bits: 15 },
    { levels: 65535, group: 0, bits: 16 },
  ];
  return MP2;
})();
JSMpeg.Decoder.MP2AudioWASM = (function () {
  "use strict";
  var MP2WASM = function (options) {
    JSMpeg.Decoder.Base.call(this, options);
    this.onDecodeCallback = options.onAudioDecode;
    this.module = options.wasmModule;
    this.bufferSize = options.audioBufferSize || 128 * 1024;
    this.bufferMode = options.streaming
      ? JSMpeg.BitBuffer.MODE.EVICT
      : JSMpeg.BitBuffer.MODE.EXPAND;
    this.sampleRate = 0;
  };
  MP2WASM.prototype = Object.create(JSMpeg.Decoder.Base.prototype);
  MP2WASM.prototype.constructor = MP2WASM;
  MP2WASM.prototype.initializeWasmDecoder = function () {
    if (!this.module.instance) {
      console.warn("JSMpeg: WASM module not compiled yet");
      return;
    }
    this.instance = this.module.instance;
    this.functions = this.module.instance.exports;
    this.decoder = this.functions._mp2_decoder_create(
      this.bufferSize,
      this.bufferMode
    );
  };
  MP2WASM.prototype.destroy = function () {
    if (!this.decoder) {
      return;
    }
    this.functions._mp2_decoder_destroy(this.decoder);
  };
  MP2WASM.prototype.bufferGetIndex = function () {
    if (!this.decoder) {
      return;
    }
    return this.functions._mp2_decoder_get_index(this.decoder);
  };
  MP2WASM.prototype.bufferSetIndex = function (index) {
    if (!this.decoder) {
      return;
    }
    this.functions._mp2_decoder_set_index(this.decoder, index);
  };
  MP2WASM.prototype.bufferWrite = function (buffers) {
    if (!this.decoder) {
      this.initializeWasmDecoder();
    }
    var totalLength = 0;
    for (var i = 0; i < buffers.length; i++) {
      totalLength += buffers[i].length;
    }
    var ptr = this.functions._mp2_decoder_get_write_ptr(
      this.decoder,
      totalLength
    );
    for (var i = 0; i < buffers.length; i++) {
      this.instance.heapU8.set(buffers[i], ptr);
      ptr += buffers[i].length;
    }
    this.functions._mp2_decoder_did_write(this.decoder, totalLength);
    return totalLength;
  };
  MP2WASM.prototype.decode = function () {
    var startTime = JSMpeg.Now();
    if (!this.decoder) {
      return false;
    }
    var decodedBytes = this.functions._mp2_decoder_decode(this.decoder);
    if (decodedBytes === 0) {
      return false;
    }
    if (!this.sampleRate) {
      this.sampleRate = this.functions._mp2_decoder_get_sample_rate(
        this.decoder
      );
    }
    if (this.destination) {
      var leftPtr = this.functions._mp2_decoder_get_left_channel_ptr(
          this.decoder
        ),
        rightPtr = this.functions._mp2_decoder_get_right_channel_ptr(
          this.decoder
        );
      var leftOffset = leftPtr / Float32Array.BYTES_PER_ELEMENT,
        rightOffset = rightPtr / Float32Array.BYTES_PER_ELEMENT;
      var left = this.instance.heapF32.subarray(
          leftOffset,
          leftOffset + MP2WASM.SAMPLES_PER_FRAME
        ),
        right = this.instance.heapF32.subarray(
          rightOffset,
          rightOffset + MP2WASM.SAMPLES_PER_FRAME
        );
      this.destination.play(this.sampleRate, left, right);
    }
    this.advanceDecodedTime(MP2WASM.SAMPLES_PER_FRAME / this.sampleRate);
    var elapsedTime = JSMpeg.Now() - startTime;
    if (this.onDecodeCallback) {
      this.onDecodeCallback(this, elapsedTime);
    }
    return true;
  };
  MP2WASM.prototype.getCurrentTime = function () {
    var enqueuedTime = this.destination ? this.destination.enqueuedTime : 0;
    return this.decodedTime - enqueuedTime;
  };
  MP2WASM.SAMPLES_PER_FRAME = 1152;
  return MP2WASM;
})();
JSMpeg.Renderer.WebGL = (function () {
  "use strict";
  var WebGLRenderer = function (options) {
    this.canvas = options.canvas || document.createElement("canvas");
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    this.enabled = true;
    this.hasTextureData = {};
    var contextCreateOptions = {
      preserveDrawingBuffer: !!options.preserveDrawingBuffer,
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      premultipliedAlpha: false,
    };
    this.gl =
      this.canvas.getContext("webgl", contextCreateOptions) ||
      this.canvas.getContext("experimental-webgl", contextCreateOptions);
    if (!this.gl) {
      throw new Error("Failed to get WebGL Context");
    }
    var gl = this.gl;
    var vertexAttr = null;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.vertexBuffer = gl.createBuffer();
    var vertexCoords = new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertexCoords, gl.STATIC_DRAW);
    this.program = this.createProgram(
      WebGLRenderer.SHADER.VERTEX_IDENTITY,
      WebGLRenderer.SHADER.FRAGMENT_YCRCB_TO_RGBA
    );
    vertexAttr = gl.getAttribLocation(this.program, "vertex");
    gl.enableVertexAttribArray(vertexAttr);
    gl.vertexAttribPointer(vertexAttr, 2, gl.FLOAT, false, 0, 0);
    this.textureY = this.createTexture(0, "textureY");
    this.textureCb = this.createTexture(1, "textureCb");
    this.textureCr = this.createTexture(2, "textureCr");
    this.loadingProgram = this.createProgram(
      WebGLRenderer.SHADER.VERTEX_IDENTITY,
      WebGLRenderer.SHADER.FRAGMENT_LOADING
    );
    vertexAttr = gl.getAttribLocation(this.loadingProgram, "vertex");
    gl.enableVertexAttribArray(vertexAttr);
    gl.vertexAttribPointer(vertexAttr, 2, gl.FLOAT, false, 0, 0);
    this.shouldCreateUnclampedViews = !this.allowsClampedTextureData();
  };
  WebGLRenderer.prototype.destroy = function () {
    var gl = this.gl;
    this.deleteTexture(gl.TEXTURE0, this.textureY);
    this.deleteTexture(gl.TEXTURE1, this.textureCb);
    this.deleteTexture(gl.TEXTURE2, this.textureCr);
    gl.useProgram(null);
    gl.deleteProgram(this.program);
    gl.deleteProgram(this.loadingProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.deleteBuffer(this.vertexBuffer);
    gl.getExtension("WEBGL_lose_context").loseContext();
    this.canvas.remove();
  };
  WebGLRenderer.prototype.resize = function (width, height) {
    this.width = width | 0;
    this.height = height | 0;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.gl.useProgram(this.program);
    var codedWidth = ((this.width + 15) >> 4) << 4;
    this.gl.viewport(0, 0, codedWidth, this.height);
  };
  WebGLRenderer.prototype.createTexture = function (index, name) {
    var gl = this.gl;
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(this.program, name), index);
    return texture;
  };
  WebGLRenderer.prototype.createProgram = function (vsh, fsh) {
    var gl = this.gl;
    var program = gl.createProgram();
    gl.attachShader(program, this.compileShader(gl.VERTEX_SHADER, vsh));
    gl.attachShader(program, this.compileShader(gl.FRAGMENT_SHADER, fsh));
    gl.linkProgram(program);
    gl.useProgram(program);
    return program;
  };
  WebGLRenderer.prototype.compileShader = function (type, source) {
    var gl = this.gl;
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
  };
  WebGLRenderer.prototype.allowsClampedTextureData = function () {
    var gl = this.gl;
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.LUMINANCE,
      1,
      1,
      0,
      gl.LUMINANCE,
      gl.UNSIGNED_BYTE,
      new Uint8ClampedArray([0])
    );
    return gl.getError() === 0;
  };
  WebGLRenderer.prototype.renderProgress = function (progress) {
    var gl = this.gl;
    gl.useProgram(this.loadingProgram);
    var loc = gl.getUniformLocation(this.loadingProgram, "progress");
    gl.uniform1f(loc, progress);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  WebGLRenderer.prototype.render = function (y, cb, cr, isClampedArray) {
    if (!this.enabled) {
      return;
    }
    var gl = this.gl;
    var w = ((this.width + 15) >> 4) << 4,
      h = this.height,
      w2 = w >> 1,
      h2 = h >> 1;
    if (isClampedArray && this.shouldCreateUnclampedViews) {
      (y = new Uint8Array(y.buffer)),
        (cb = new Uint8Array(cb.buffer)),
        (cr = new Uint8Array(cr.buffer));
    }
    gl.useProgram(this.program);
    this.updateTexture(gl.TEXTURE0, this.textureY, w, h, y);
    this.updateTexture(gl.TEXTURE1, this.textureCb, w2, h2, cb);
    this.updateTexture(gl.TEXTURE2, this.textureCr, w2, h2, cr);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  WebGLRenderer.prototype.updateTexture = function (unit, texture, w, h, data) {
    var gl = this.gl;
    gl.activeTexture(unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (this.hasTextureData[unit]) {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        w,
        h,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        data
      );
    } else {
      this.hasTextureData[unit] = true;
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.LUMINANCE,
        w,
        h,
        0,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        data
      );
    }
  };
  WebGLRenderer.prototype.deleteTexture = function (unit, texture) {
    var gl = this.gl;
    gl.activeTexture(unit);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteTexture(texture);
  };
  WebGLRenderer.IsSupported = function () {
    try {
      if (!window.WebGLRenderingContext) {
        return false;
      }
      var canvas = document.createElement("canvas");
      return !!(
        canvas.getContext("webgl") || canvas.getContext("experimental-webgl")
      );
    } catch (err) {
      return false;
    }
  };
  WebGLRenderer.SHADER = {
    FRAGMENT_YCRCB_TO_RGBA: [
      "precision mediump float;",
      "uniform sampler2D textureY;",
      "uniform sampler2D textureCb;",
      "uniform sampler2D textureCr;",
      "varying vec2 texCoord;",
      "mat4 rec601 = mat4(",
      "1.16438,  0.00000,  1.59603, -0.87079,",
      "1.16438, -0.39176, -0.81297,  0.52959,",
      "1.16438,  2.01723,  0.00000, -1.08139,",
      "0, 0, 0, 1",
      ");",
      "void main() {",
      "float y = texture2D(textureY, texCoord).r;",
      "float cb = texture2D(textureCb, texCoord).r;",
      "float cr = texture2D(textureCr, texCoord).r;",
      "gl_FragColor = vec4(y, cr, cb, 1.0) * rec601;",
      "}",
    ].join("\n"),
    FRAGMENT_LOADING: [
      "precision mediump float;",
      "uniform float progress;",
      "varying vec2 texCoord;",
      "void main() {",
      "float c = ceil(progress-(1.0-texCoord.y));",
      "gl_FragColor = vec4(c,c,c,1);",
      "}",
    ].join("\n"),
    VERTEX_IDENTITY: [
      "attribute vec2 vertex;",
      "varying vec2 texCoord;",
      "void main() {",
      "texCoord = vertex;",
      "gl_Position = vec4((vertex * 2.0 - 1.0) * vec2(1, -1), 0.0, 1.0);",
      "}",
    ].join("\n"),
  };
  return WebGLRenderer;
})();
JSMpeg.Renderer.Canvas2D = (function () {
  "use strict";
  var CanvasRenderer = function (options) {
    this.canvas = options.canvas || document.createElement("canvas");
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    this.enabled = true;
    this.context = this.canvas.getContext("2d");
  };
  CanvasRenderer.prototype.destroy = function () {
    this.canvas.remove();
  };
  CanvasRenderer.prototype.resize = function (width, height) {
    this.width = width | 0;
    this.height = height | 0;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.imageData = this.context.getImageData(0, 0, this.width, this.height);
    JSMpeg.Fill(this.imageData.data, 255);
  };
  CanvasRenderer.prototype.renderProgress = function (progress) {
    var w = this.canvas.width,
      h = this.canvas.height,
      ctx = this.context;
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, h - h * progress, w, h * progress);
  };
  CanvasRenderer.prototype.render = function (y, cb, cr) {
    this.YCbCrToRGBA(y, cb, cr, this.imageData.data);
    this.context.putImageData(this.imageData, 0, 0);
  };
  CanvasRenderer.prototype.YCbCrToRGBA = function (y, cb, cr, rgba) {
    if (!this.enabled) {
      return;
    }
    var w = ((this.width + 15) >> 4) << 4,
      w2 = w >> 1;
    var yIndex1 = 0,
      yIndex2 = w,
      yNext2Lines = w + (w - this.width);
    var cIndex = 0,
      cNextLine = w2 - (this.width >> 1);
    var rgbaIndex1 = 0,
      rgbaIndex2 = this.width * 4,
      rgbaNext2Lines = this.width * 4;
    var cols = this.width >> 1,
      rows = this.height >> 1;
    var ccb, ccr, r, g, b;
    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        ccb = cb[cIndex];
        ccr = cr[cIndex];
        cIndex++;
        r = ccb + ((ccb * 103) >> 8) - 179;
        g = ((ccr * 88) >> 8) - 44 + ((ccb * 183) >> 8) - 91;
        b = ccr + ((ccr * 198) >> 8) - 227;
        var y1 = y[yIndex1++];
        var y2 = y[yIndex1++];
        rgba[rgbaIndex1] = y1 + r;
        rgba[rgbaIndex1 + 1] = y1 - g;
        rgba[rgbaIndex1 + 2] = y1 + b;
        rgba[rgbaIndex1 + 4] = y2 + r;
        rgba[rgbaIndex1 + 5] = y2 - g;
        rgba[rgbaIndex1 + 6] = y2 + b;
        rgbaIndex1 += 8;
        var y3 = y[yIndex2++];
        var y4 = y[yIndex2++];
        rgba[rgbaIndex2] = y3 + r;
        rgba[rgbaIndex2 + 1] = y3 - g;
        rgba[rgbaIndex2 + 2] = y3 + b;
        rgba[rgbaIndex2 + 4] = y4 + r;
        rgba[rgbaIndex2 + 5] = y4 - g;
        rgba[rgbaIndex2 + 6] = y4 + b;
        rgbaIndex2 += 8;
      }
      yIndex1 += yNext2Lines;
      yIndex2 += yNext2Lines;
      rgbaIndex1 += rgbaNext2Lines;
      rgbaIndex2 += rgbaNext2Lines;
      cIndex += cNextLine;
    }
  };
  return CanvasRenderer;
})();
JSMpeg.AudioOutput.WebAudio = (function () {
  "use strict";
  var WebAudioOut = function (options) {
    this.context = WebAudioOut.CachedContext =
      WebAudioOut.CachedContext ||
      new (window.AudioContext || window.webkitAudioContext)();
    this.gain = this.context.createGain();
    this.destination = this.gain;
    this.gain.connect(this.context.destination);
    this.context._connections = (this.context._connections || 0) + 1;
    this.startTime = 0;
    this.buffer = null;
    this.wallclockStartTime = 0;
    this.volume = 1;
    this.enabled = true;
    this.unlocked = !WebAudioOut.NeedsUnlocking();
    Object.defineProperty(this, "enqueuedTime", { get: this.getEnqueuedTime });
  };
  WebAudioOut.prototype.destroy = function () {
    this.gain.disconnect();
    this.context._connections--;
    if (this.context._connections === 0) {
      this.context.close();
      WebAudioOut.CachedContext = null;
    }
  };
  WebAudioOut.prototype.play = function (sampleRate, left, right) {
    if (!this.enabled) {
      return;
    }
    if (!this.unlocked) {
      var ts = JSMpeg.Now();
      if (this.wallclockStartTime < ts) {
        this.wallclockStartTime = ts;
      }
      this.wallclockStartTime += left.length / sampleRate;
      return;
    }
    this.gain.gain.value = this.volume;
    var buffer = this.context.createBuffer(2, left.length, sampleRate);
    buffer.getChannelData(0).set(left);
    buffer.getChannelData(1).set(right);
    var source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.destination);
    var now = this.context.currentTime;
    var duration = buffer.duration;
    if (this.startTime < now) {
      this.startTime = now;
      this.wallclockStartTime = JSMpeg.Now();
    }
    source.start(this.startTime);
    this.startTime += duration;
    this.wallclockStartTime += duration;
  };
  WebAudioOut.prototype.stop = function () {
    this.gain.gain.value = 0;
  };
  WebAudioOut.prototype.getEnqueuedTime = function () {
    return Math.max(this.wallclockStartTime - JSMpeg.Now(), 0);
  };
  WebAudioOut.prototype.resetEnqueuedTime = function () {
    this.startTime = this.context.currentTime;
    this.wallclockStartTime = JSMpeg.Now();
  };
  WebAudioOut.prototype.unlock = function (callback) {
    if (this.unlocked) {
      if (callback) {
        callback();
      }
      return;
    }
    this.unlockCallback = callback;
    var buffer = this.context.createBuffer(1, 1, 22050);
    var source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.destination);
    source.start(0);
    setTimeout(this.checkIfUnlocked.bind(this, source, 0), 0);
  };
  WebAudioOut.prototype.checkIfUnlocked = function (source, attempt) {
    if (
      source.playbackState === source.PLAYING_STATE ||
      source.playbackState === source.FINISHED_STATE
    ) {
      this.unlocked = true;
      if (this.unlockCallback) {
        this.unlockCallback();
        this.unlockCallback = null;
      }
    } else if (attempt < 10) {
      setTimeout(this.checkIfUnlocked.bind(this, source, attempt + 1), 100);
    }
  };
  WebAudioOut.NeedsUnlocking = function () {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
  };
  WebAudioOut.IsSupported = function () {
    return window.AudioContext || window.webkitAudioContext;
  };
  WebAudioOut.CachedContext = null;
  return WebAudioOut;
})();
JSMpeg.WASMModule = (function () {
  "use strict";
  var WASM = function () {
    this.stackSize = 5 * 1024 * 1024;
    this.pageSize = 64 * 1024;
    this.onInitCallback = null;
    this.ready = false;
  };
  WASM.prototype.write = function (buffer) {
    this.loadFromBuffer(buffer, this.onInitCallback);
  };
  WASM.prototype.loadFromFile = function (url, callback) {
    this.onInitCallback = callback;
    var ajax = new JSMpeg.Source.Ajax(url, {});
    ajax.connect(this);
    ajax.start();
  };
  WASM.prototype.loadFromBuffer = function (buffer, callback) {
    this.moduleInfo = this.readDylinkSection(buffer);
    if (!this.moduleInfo) {
      this.callback && this.callback(null);
      return;
    }
    this.memory = new WebAssembly.Memory({ initial: 256 });
    var env = {
      memory: this.memory,
      memoryBase: 0,
      __memory_base: 0,
      table: new WebAssembly.Table({
        initial: this.moduleInfo.tableSize,
        element: "anyfunc",
      }),
      tableBase: 0,
      __table_base: 0,
      abort: this.c_abort.bind(this),
      ___assert_fail: this.c_assertFail.bind(this),
      _sbrk: this.c_sbrk.bind(this),
    };
    this.brk = this.align(this.moduleInfo.memorySize + this.stackSize);
    WebAssembly.instantiate(buffer, { env: env }).then(
      function (results) {
        this.instance = results.instance;
        if (this.instance.exports.__post_instantiate) {
          this.instance.exports.__post_instantiate();
        }
        this.createHeapViews();
        this.ready = true;
        callback && callback(this);
      }.bind(this)
    );
  };
  WASM.prototype.createHeapViews = function () {
    this.instance.heapU8 = new Uint8Array(this.memory.buffer);
    this.instance.heapU32 = new Uint32Array(this.memory.buffer);
    this.instance.heapF32 = new Float32Array(this.memory.buffer);
  };
  WASM.prototype.align = function (addr) {
    var a = Math.pow(2, this.moduleInfo.memoryAlignment);
    return Math.ceil(addr / a) * a;
  };
  WASM.prototype.c_sbrk = function (size) {
    var previousBrk = this.brk;
    this.brk += size;
    if (this.brk > this.memory.buffer.byteLength) {
      var bytesNeeded = this.brk - this.memory.buffer.byteLength;
      var pagesNeeded = Math.ceil(bytesNeeded / this.pageSize);
      this.memory.grow(pagesNeeded);
      this.createHeapViews();
    }
    return previousBrk;
  };
  WASM.prototype.c_abort = function (size) {
    console.warn("JSMPeg: WASM abort", arguments);
  };
  WASM.prototype.c_assertFail = function (size) {
    console.warn("JSMPeg: WASM ___assert_fail", arguments);
  };
  WASM.prototype.readDylinkSection = function (buffer) {
    var bytes = new Uint8Array(buffer);
    var next = 0;
    var readVarUint = function () {
      var ret = 0;
      var mul = 1;
      while (1) {
        var byte = bytes[next++];
        ret += (byte & 127) * mul;
        mul *= 128;
        if (!(byte & 128)) {
          return ret;
        }
      }
    };
    var matchNextBytes = function (expected) {
      for (var i = 0; i < expected.length; i++) {
        var b =
          typeof expected[i] === "string"
            ? expected[i].charCodeAt(0)
            : expected[i];
        if (bytes[next++] !== b) {
          return false;
        }
      }
      return true;
    };
    if (!matchNextBytes([0, "a", "s", "m"])) {
      console.warn("JSMpeg: WASM header not found");
      return null;
    }
    var next = 9;
    var sectionSize = readVarUint();
    if (!matchNextBytes([6, "d", "y", "l", "i", "n", "k"])) {
      console.warn("JSMpeg: No dylink section found in WASM");
      return null;
    }
    return {
      memorySize: readVarUint(),
      memoryAlignment: readVarUint(),
      tableSize: readVarUint(),
      tableAlignment: readVarUint(),
    };
  };
  WASM.IsSupported = function () {
    return !!window.WebAssembly;
  };
  WASM.GetModule = function () {
    WASM.CACHED_MODULE = WASM.CACHED_MODULE || new WASM();
    return WASM.CACHED_MODULE;
  };
  return WASM;
})();
JSMpeg.WASM_BINARY_INLINED =
  "AGFzbQEAAAAADwZkeWxpbmvwz8ACBAAAAAE0CWAEf39/fwBgAX8Bf2ACf38Bf2ABfwBgAn9/AGABfwF9YAZ/f39/f38AYAN/f38Bf2AAAAJGBANlbnYOX19fYXNzZXJ0X2ZhaWwAAANlbnYFX3NicmsAAQNlbnYNX19tZW1vcnlfYmFzZQN/AANlbnYGbWVtb3J5AgCAAgM9PAIDAgEEBAMBBQEBAQEBAQEDBAMGAwQAAwAAAAIDAgEEBAEBAQEBAAACAwIBAgECAQEBAQMEAwMCBwcHCAYLAn8BQQALfwFBAAsHggYfEl9fcG9zdF9pbnN0YW50aWF0ZQA9BV9mcmVlADgHX21hbGxvYwAxB19tZW1jcHkAOghfbWVtbW92ZQA7B19tZW1zZXQAPBNfbXAyX2RlY29kZXJfY3JlYXRlAB0TX21wMl9kZWNvZGVyX2RlY29kZQAmFF9tcDJfZGVjb2Rlcl9kZXN0cm95AB4WX21wMl9kZWNvZGVyX2RpZF93cml0ZQAiFl9tcDJfZGVjb2Rlcl9nZXRfaW5kZXgAICFfbXAyX2RlY29kZXJfZ2V0X2xlZnRfY2hhbm5lbF9wdHIAJCJfbXAyX2RlY29kZXJfZ2V0X3JpZ2h0X2NoYW5uZWxfcHRyACUcX21wMl9kZWNvZGVyX2dldF9zYW1wbGVfcmF0ZQAjGl9tcDJfZGVjb2Rlcl9nZXRfd3JpdGVfcHRyAB8WX21wMl9kZWNvZGVyX3NldF9pbmRleAAhFV9tcGVnMV9kZWNvZGVyX2NyZWF0ZQACFV9tcGVnMV9kZWNvZGVyX2RlY29kZQARFl9tcGVnMV9kZWNvZGVyX2Rlc3Ryb3kAAxhfbXBlZzFfZGVjb2Rlcl9kaWRfd3JpdGUABxlfbXBlZzFfZGVjb2Rlcl9nZXRfY2JfcHRyABAdX21wZWcxX2RlY29kZXJfZ2V0X2NvZGVkX3NpemUACxlfbXBlZzFfZGVjb2Rlcl9nZXRfY3JfcHRyAA8dX21wZWcxX2RlY29kZXJfZ2V0X2ZyYW1lX3JhdGUAChlfbXBlZzFfZGVjb2Rlcl9nZXRfaGVpZ2h0AA0YX21wZWcxX2RlY29kZXJfZ2V0X2luZGV4AAUYX21wZWcxX2RlY29kZXJfZ2V0X3dpZHRoAAwcX21wZWcxX2RlY29kZXJfZ2V0X3dy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BQJ/IANBzQBHDQIgACgCgAFBBhAwIQMCQAJAIAAoAoABQQgQMCIEIgYEQCAGQYABRgRADAIFDAMLAAsgACgCgAFBCBAwDAILIAAoAoABQQgQMEGAfmoMAQsgBEGAfmogBCAEQYABShsLCyEEDAELIAZB/wFxIgNBACADayAAKAKAAUEBEDBFGyEEIAZBCHUhAwsgAiADaiIGIwBBQGtqLQAAIgMgBWotAAAgACgCREEAIARBAXQiAkEfdUEBciAAKAJcGyACamxsIgJBBHVBAEEBQX8gAkEPShsgAkEQcRtrIgJBgHAgAkGAcEobIQIgAEGcAWogA0ECdGogAyMAQZA1amotAAAgAkH/DyACQf8PSBtsNgIAIAZBAWohAgwBCwsgAUEESARAIABBhAFqIQUgAUEDdEEIcSAAKAJUIAAoAhgiAyAAKAJQbGpBBHRyIANBA3RBACABQQJxG2ohBAUgAEGMAWogAEGIAWogAUEERhshBSAAKAJQIAAoAhgiAUECdGwgACgCVEEDdGohBCABQQF1IQMLIANBeGohAyAFKAIAIQUgAkEBRiECIABBnAFqIQEgACgCXARAIAIEQCABKAIAQYABakEIdSAFIAQgAxAYIAFBADYCAAUgARAZIAEgBSAEIAMQGiABQQBBgAIQPBoLBSACBEAgASgCAEGAAWpBCHUgBSAEIAMQGyABQQA2AgAFIAEQGSABIAUgBCADEBwgAUEAQYACEDwaCwsL7AYAIAEgAmogAEEAIABBAEobIgBB/wEgAEH/AUgbQf8BcSIAOgAAIAEgAkEBamogADoAACABIAJBAmpqIAA6AAAgASACQQNqaiAAOgAAIAEgAkEEamogADoAACABIAJBBWpqIAA6AAAgASACQQZqaiAAOgAAIAEgAkEHamogADoAACABIAIgA0EIaiIDaiICaiAAOgAAIAEgAkEBamogADoAACABIAJBAmpqIAA6AAAgASACQQNqaiAAOgAAIAEgAkEEamogADoAACABIAJBBWpqIAA6AAAgASACQQZqaiAAOgAAIAEgAkEHamogADoAACABIAIgA2oiAmogADoAACABIAJBAWpqIAA6AAAgASACQQJqaiAAOgAAIAEgAkEDamogADoAACABIAJBBGpqIAA6AAAgASACQQVqaiAAOgAAIAEgAkEGamogADoAACABIAJBB2pqIAA6AAAgASACIANqIgJqIAA6AAAgASACQQFqaiAAOgAAIAEgAkECamogADoAACABIAJBA2pqIAA6AAAgASACQQRqaiAAOgAAIAEgAkEFamogADoAACABIAJBBmpqIAA6AAAgASACQQdqaiAAOgAAIAEgAiADaiICaiAAOgAAIAEgAkEBamogADoAACABIAJBAmpqIAA6AAAgASACQQNqaiAAOgAAIAEgAkEEamogADoAACABIAJBBWpqIAA6AAAgASACQQZqaiAAOgAAIAEgAkEHamogADoAACABIAIgA2oiAmogADoAACABIAJBAWpqIAA6AAAgASACQQJqaiAAOgAAIAEgAkEDamogADoAACABIAJBBGpqIAA6AAAgASACQQVqaiAAOgAAIAEgAkEGamogADoAACABIAJBB2pqIAA6AAAgASACIANqIgJqIAA6AAAgASACQQFqaiAAOgAAIAEgAkECamogADoAACABIAJBA2pqIAA6AAAgASACQQRqaiAAOgAAIAEgAkEFamogADoAACABIAJBBmpqIAA6AAAgASACQQdqaiAAOgAAIAEgAiADaiICaiAAOgAAIAEgAkEBamogADoAACABIAJBAmpqIAA6AAAgASACQQNqaiAAOgAAIAEgAkEEamogADoAACABIAJBBWpqIAA6AAAgASACQQZqaiAAOgAAIAEgAkEHamogADoAAAubBgEUfwNAIAFBEGpBAnQgAGoiBygCACIGIAFBMGpBAnQgAGoiDSgCACIJaiEFIAFBCGpBAnQgAGoiDigCACICIAFBOGpBAnQgAGoiDygCACIDaiEEIAIgA2siEEHZA2wgAUEoakECdCAAaiIKKAIAIgIgAUEYakECdCAAaiIRKAIAIgNrIgtBvH5sQYABampBCHUgBCACIANqIghqIgJrIgMgBCAIa0HqAmxBgAFqQQh1ayEEIAFBAnQgAGoiCCgCACIMIAFBIGpBAnQgAGoiEigCACITayIUIAYgCWtB6gJsQYABakEIdSAFayIJaiEGIAggAiAMIBNqIgggBWoiDGo2AgAgDiADIAZqNgIAIAcgFCAJayIHIARrNgIAIBEgC0HZA2xBgAFqIBBBxAFsakEIdSAEaiIJIAggBWsiBWo2AgAgEiAFIAlrNgIAIAogBCAHajYCACANIAYgA2s2AgAgDyAMIAJr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aiABQQxsaiAAKAIIQQYQMCICNgLUAiAAIANBgANsaiABQQxsaiACNgLQAiAFIAI2AgAMAgsgBSAAKAIIQQYQMDYCACAAIANBgANsaiABQQxsaiAAKAIIQQYQMCICNgLUAiAAIANBgANsaiABQQxsaiACNgLQAgsLCyADQQFqIgMgCEkNAAsgAUEBaiIBIAtHDQALCwsLaiALQSBJIRwgAEHM9gBqIRYgAEHMlgFqIQQgAEHMCGohHSAAQcwLaiEeA0BBACEXIBQhAwNAIBkEQEEAIQEDQCAAQQAgASAOECggAEEBIAEgDhAoIAFBAWoiASANSA0ACwsgGgRAIA0hAQNAIABBACABIA4QKCAAQcwLaiABQQxsaiAAQcwIaiABQQxsaigCADYCACAAIAFBDGxqQdALaiAAIAFBDGxqQdAIaigCADYCACAAIAFBDGxqQdQLaiAAIAFBDGxqQdQIaigCADYCACABQQFqIgEgC0gNAAsLIBwEQCALIQEDQCAAQcwIaiABQQxsakEANgIAIAAgAUEMbGpB0AhqQQA2AgAgACABQQxsakHUCGpBADYCACAAQcwLaiABQQxsakEANgIAIAAgAUEMbGpB0AtqQQA2AgAgACABQQxsakHUC2pBADYCACABQQFqIgFBIEcNAAsLIAAoAgQhASADIRFBACESA0AgACABQcAHakH/B3EiATYCBCAdIBIgFiABECkgBEIANwIAIARCADcCCCAEQgA3AhAgBEIANwIYIARCADcCICAEQgA3AiggBEIANwIwIARCADcCOCAEQUBrQgA3AgAgBEIANwJIIARCADcCUCAEQgA3AlggBEIANwJgIARCADcCaCAEQgA3AnAgBEIANwJ4IAAoAgQiD0EBdSETQf8HIA9BgAFvQQF1IgxrIgFBgH9xIRUgAUEHdkEGdEHABGohEEGABCATayEGIAwhAQNAIAYhB0EAIQkgASECA0AgB0EBaiEIIAJBAWohBSAAQcyWAWogCUECdGoiCiAAQczWAGogB0ECdGoqAgAgAEHM9gBqIAJBAnRqKgIAlCAKKAIAspKoNgIAIAlBAWoiCUEgRwRAIAghByAFIQIMAQsLIAFBgAFqIQIgBkFAayEGIAFBgAdIBEAgAiEBDAELC0HgByAMIBVqayIBQYAISARAIBAgE2tBoHxqIQYDQCABQR9qIAYh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ujBFka7n9D+itiJLk7tEuEt/Zp6g5j+itiI6kiEqIANBMGpBAnQgAmogTSA8kow4AgAgA0EvakECdCACaiApICiSIEwgSZIgJJIiKJKMIik4AgAgA0ExakECdCACaiApOAIAIANBLmpBAnQgAmogRiBFkiAjkowiKTgCACADQTJqQQJ0IAJqICk4AgAgA0EtakECdCACaiAwIC2SIEAgPpIgJpIiKZIiPCAokowiKDgCACADQTNqQQJ0IAJqICg4AgAgA0EsakECdCACaiA2IE+SIFEgUJIgNZIiKJKMIjY4AgAgA0E0akECdCACaiA2OAIAIANBK2pBAnQgAmogPCA/IDiSIDOSIjwgJJIiJJKMIjY4AgAgA0E1akECdCACaiA2OAIAIANBKmpBAnQgAmogPSBSkiA7kiI9ICOSjCIjOAIAIANBNmpBAnQgAmogIzgCACADQSlqQQJ0IAJqIEsgSpIgOpIiIyAkkowiJDgCACADQTdqQQJ0IAJqICQ4AgAgA0EoakECdCACaiBIIE6SIDGSjCIkOAIAIANBOGpBAnQgAmogJDgCACADQSdqQQJ0IAJqICMgPCArkiIjkowiJDgCACADQTlqQQJ0IAJqICQ4AgAgA0EmakECdCACaiA9ICeSjCIkOAIAIANBOmpBAnQgAmogJDgCACADQSVqQQJ0IAJqICkgLSAwk7tEuEt/Zp6g5j+itiIpkiItICOSjCIjOAIAIANBO2pBAnQgAmogIzgCACADQSRqQQJ0IAJqICggR5KMIiM4AgAgA0E8akECdCACaiAjOAIAIANBI2pBAnQgAmogLSArIDKSIiOSjCIoOAIAIANBPWpBAnQgAmogKDgCACADQSJqQQJ0IAJqICcgU5KMIic4AgAgA0E+akECdCACaiAnOAIAIANBIWpBAnQgAmogIyBCkowiIzgCACADQT9qQQJ0IAJqICM4AgAgA0EgakECdCACaiA0jDgCACADQQJ0IAJqIDQ4AgAgA0EfakECdCACaiAsjDgCACADQQFqQQJ0IAJqICw4AgAgA0EeakECdCACaiA5jDgCACADQQJqQQJ0IAJqIDk4AgAgA0EdakECdCACaiApICaSIjQgQZIiI4w4AgAgA0EDakECdCACaiAjOAIAIANBHGpBAnQgAmogL4w4AgAgA0EEakECdCACaiAvOAIAIANBG2pBAnQgAmogNCA3IDOSIjSSIi+MOAIAIANBBWpBAnQgAmogLzgCACADQRpqQQJ0IAJqIEQgO5IiL4w4AgAgA0EGakECdCACaiAvOAIAIANBGWpBAnQgAmogNCA6kiI0jDgCACADQQdqQQJ0IAJqIDQ4AgAgA0EYakECdCACaiAxjDgCACADQQhqQQJ0IAJqIDE4AgAgA0EXakECdCACaiAqjDgCACADQQlqQQJ0IAJqICo4AgAgA0EWakECdCACaiA7IC6SIjGMOAIAIANBCmpBAnQgAmogMTgCACADQRVqQQJ0IAJqIEMgJpIiMYw4AgAgA0ELakECdCACaiAxOAIAIANBFGpBAnQgAmogNYw4AgAgA0EMakECdCACaiA1OAIAIANBE2pBAnQgAmogJiAlkiImjDgCACADQQ1qQQJ0IAJqICY4AgAgA0ESakECdCACaiAujDgCACADQQ5qQQJ0IAJqIC44AgAgA0ERakECdCACaiAljDgCACADQQ9qQQJ0IAJqICU4AgAgA0EQakECdCACakMAAAAAOAIACy8BAX9BFBAxIgIgATYCECACIAAQMTYCACACIAA2AgggAkEANgIMIAJBADYCBCACCw0AIAAoAgAQOCAAEDgL6QEBBH8gACgCCCIDIAAoAgwiAmsiBCABSQRAAkAgACgCEEECRgRAIAAgACgCACABIARrIANBAXQiAiACIARqIAFJGyIBEDk2AgAgACABNgIIIAAoAgQgACgCDCIBQQN0IgJNDQEgACACNgIEDAELIAIgACgCBCIFQQN2IgNGIAMgBGogAUlyBEAgAEEANgIMIABBADYCBEEAIQEMAQsgAwRAIAAoAgAiASABIANqIAIgA2sQOxogACAAKAIMIANrIgE2AgwgACAAKAIEIAVBeHFrNgIEBSACIQELCwUgAiEBCyAAKAIAIAFqC40BAQR/IAAoAgRBB2pBA3YiASAAKAIMIgRJBEACQCAAKAIAIQIDQAJAIAFBAWohAyABIAJqLAAARQRAIAIgA2osAABFBEAgAiABQQJqaiwAAEEBRg0CCwsgAyAETw0CIAMhAQwBCwsgACABQQN0QSBqNgIEIAIgAUEDamotAAAPCwsgACAEQQN0NgIEQX8LqQEBBH8gACgCBEEHakEDdiICIAAoAgwiBUkEQAJAIAAoAgAhBANAAkAgAkEBaiEDAkACQCACIARqLAAADQAgAyAEaiwAAA0AIAQgAkECamosAABBAUcNACAAIAJBA3QiA0EgajYCBCABIAQgAkEDamotAABGDQIgA0EnakEDdiICIAVPDQQMAQsgAyAFTw0DIAMhAgsMAQsLIAEPCwsgACAFQQN0NgIEQX8LTwEBfyAAKAIEQQdqQQN2IgEgACgCDE8EQEEBDwsgACgCACIAIAFqLAAABEBBAA8LIAAgAUEBamosAAAEQEEADwsgACABQQJqaiwAAEEBRguGAQEGfyAAKAIEIQYgAUUEQCAAIAEgBmo2AgRBAA8LIAAoAgAhByABIQMgBiEEA0AgAkEIIARBB3FrIgIgAyACIANJGyIFdCAHIARBA3VqLQAAQf8BQQggBWt2IAIgBWsiAnRxIAJ2ciECIAQgBWohBCADIAVrIgMNAAsgACABIAZqNgIEIAILhgMBA38gAEUEQEEADwsgABAyIgEEQCABIQAFAkACQCMAQaTOwAJqKAIAIgFFDQAgASgCACICQQFxDQAgASACQQFyNgIAIAJBAXZBeGoiAkUEQCMAQeXIAGojAEHuyABqQYICIwBBpckAahAAC0EfIAJBCCACQQhLGyICZ2tBASACGyICQX1qQR1PBEAjAEG2yQBqIwBB7sgAakGHAiMAQaXJAGoQAAsjAEGgzQBqIAJBAnRqIgMoAgAgAUEIaiICRgRAIAMgASgCDDYCAAsgAigCACIDBEAgAyABKAIMNgIECyABKAIMIgEEQCABIAIoAgA2AgALIAAQM0UjAEGkzsACaigCACEABEAgACAAKAIAQX5xNgIAQQAPCwwBCyAAEDQhAAsgAEUEQEEADwsLIAAoAgBBAXYgAGpBABABSwRAIwBB8MkAaiMAQe7IAGpBtwYjAEGMygBqEAALIAAoAgBBAXFFBEAjAEGcygBqIwBB7sgAakHOASMAQa7KAGoQAAsgAEEIaguJBQEFfyAARQRAIwBB5cgAaiMAQe7IAGpBkgIjAEHRywBqEAALQR8gAEEIIABBCEsbIgFna0EBIAEbIgFBfWpBHU8EQCMAQbbJAGojAEHuyABqQYcCIwBBpckAahAACyAAaUEBRyABaiIDQQNLQQEgA3QgAEtxBEAjACADQQJ0akGczQBqKAIAIgEEQAJAA0AgAUF4aiIEKAIAQQF2QXhqIgUgAEkEQCABKAIEIgFBAEcgAkEBaiICQSBJcUUNAgwBCwsgBUUEQCMAQeXIAGojAEHuyABqQYICIwBBpckAahAAC0EfIAVBCCAFQQhLGyICZ2tBASACGyICQX1qQR1PBEAjAEG2yQBqIwBB7sgAakGHAiMAQaXJAGoQAAsjAEGgzQBqIAJBAnRqIgIoAgAgAUYEQCACIAEoAgQ2AgALIAEoAgAiAgRAIAIgASgCBDYCBAsgASgCBCICBEAgAiABKAIANgIACyAEIAQoAgBBAXI2AgAgBCAAEDYgBA8LCwsgA0EgTwRAQQAPCyADIQECQAJAA0AjAEGgzQBqIAFBAnRqKAIAIgJFBEAgAUEBaiIBQSBPDQIMAQsLDAELQQAPCyACQXhqIgEoAgBBAXZBeGoiA0UEQCMAQeXIAGojAEHuyABqQYICIwBBpckAahAAC0EfIANBCCADQQhLGyIDZ2tBASADGyIDQX1qQR1PBEAjAEG2yQBqIwBB7sgAakGHAiMAQaXJAGoQAAsgAiMAQaDNAGogA0ECdGoiAygCAEYEQCADIAIoAgQ2AgALIAIoAgAiAwRAIAMgAigCBDYCBAsgAigCBCIDBEAgAyACKAIANgIACyABIAEoAgBBAXI2AgAgASAAEDYgAQvDAgEEfyAAQQ9qQXhxIwBBpM7AAmooAgAoAgBBAXZrIgMQASICQX9GBEBBAA8LIwBBpM7AAmooAgAiACgCACIEQQF2IQEgAiAAIAFqRwRAIwBBlssAaiMAQe7IAGpBqwMjAEGyywBqEAALIARBAXFFBEAgAUF4aiIBRQRAIwBB5cgAaiMAQe7IAGpBggIjAEGlyQBqEAALQR8gAUEIIAFBCEsbIgFna0EBIAEbIgFBfWpBHU8EQCMAQbbJAGojAEHuyABqQYcCIwBBpckAahAACyMAQaDNAGogAUECdGoiAigCACAAQQhqIgFGBEAgAiAAKAIMNgIACyABKAIAIgIEQCACIAAoAgw2AgQLIAAoAgwiAgRAIAIgASgCADYCAAsLIAAgACgCACADQQF0aiIBNgIAIAFBAXEEQEEBDwsgABA1QQEL1QIBBX8gAEEPakF4cSIEEAEiAUF/RgRAQQAPCwJAAkAgAUEHakF4cSIAIgUgAUYEQCMAQaDOwAJqKAIAQQBHIQIjAEGkzsACaigCACIBRQRAIAJFDQIjAEH9ygBqIwBB7sgAakH3BSMAQeLKAGoQAAsgAgRAIAAgATYCBCAAIQMFIwBBissAaiMAQe7IAGpB+wUjAEHiygBqEAALBSAAIAFrEAEiAkF/RgRAQQAPCyACIAEgBGpHBEAjAEG5ygBqIwBB7sgAakHsBSMAQeLKAGoQAAsjAEGkzsACaigCAARAIwBB8coAaiMAQe7IAGpB7gUjAEHiygBqEAALIwBBoM7AAmooAgBFDQEjAEH9ygBqIwBB7sgAakH3BSMAQeLKAGoQAAsMAQsjAEGgzsACaiAFNgIAIAAhAwsjAEGkzsACaiAFNgIAIAMgBEEBdEEBcjYCACADC9IBAQJ/IAAgACgCAEEBdmpBABABSwRAIwBB8MkAaiMAQe7IAGpBvAIjAEHDywBqEAALIAAoAgBBAXZBeGoiAUUEQCMAQeXIAGojAEHuyABqQYICIwBBpckAahAAC0EfIAFBCCABQQhLGyIBZ2tBASABGyIBQX1qQR1PBEAjAEG2yQBqIwBB7sgAakGHAiMAQaXJAGoQAAsjAEGgzQBqIAFBAnRqIgIoAgAhASACIABBCGoiAjYCACAAQQA2AgggACABNgIMIAFFBEAPCyABIAI2AgALzwIBBH8gACgCACIEQQF2IgVBeGoiAyABSQRAIwBB68sAaiMAQe7IAGpBtgMjAEH/ywBqEAALIAMgAWsiA0F4cUEIRiAAIwBBpM7AAmooAgBGcQRAIAUQM0UEQA8LIANBCGpBD0sEQCAAKAIAIQIFIwBBlswAaiMAQe7IAGpBxwMjAEH/ywBqEAALBSADQQ9LBH8gBAUPCyECCyACQQFxIgRFBEAjAEGcygBqIwBB7sgAakHOASMAQa7KAGoQAAsgACAEIAAgAWpBD2pBeHEiASAAa0EBdHI2AgAgACACQQF2aiABayICQQ9NBEAjAEGvzABqIwBB7sgAakHWAyMAQf/LAGoQAAsgASABKAIAQQFxIAJBAXRyNgIAIAEgADYCBCMAQaTOwAJqIAEgAkH/////B3FqQQRqIAAjAEGkzsACaigCAEYbIAE2AgAgARA3C6gHAQd/IAAgACgCACIDQX5xNgIAIAAgA0EBdmpBABABSwRAIwBB8MkAaiMAQe7IAGpBzgIjAEHRzABqEAALIAAoAgQhASAAIwBBpM7AAmooAgAiBUYiBwR/QQAhA0EABSAAIAAoAgBBAXZqIgMLIQYgAQRAIAEoAgAiAkEBcUUEQCACQQF2QXhqIgJFBEAjAEHlyABqIwBB7sgAakGCAiMAQaXJAGoQAAtBHyACQQggAkEISxsiAmdrQQEgAhsiAkF9akEdTwRAIwBBtskAaiMAQe7IAGpBhwIjAEGlyQBqEAALIwBBoM0AaiACQQJ0aiIEKAIAIAFBCGoiAkYEQCAEIAEoAgw2AgALIAIoAgAiBARAIAQgASgCDDYCBAsgASgCDCIEBEAgBCACKAIANgIACyABIAEoAgAgACgCAEF+cWo2AgACQAJAIAMEQCADIAE2AgQgAygCACIAQQFxRQRAIABBAXZBeGoiAEUEQCMAQeXIAGojAEHuyABqQYICIwBBpckAahAAC0EfIABBCCAAQQhLGyIAZ2tBASAAGyIAQX1qQR1PBEAjAEG2yQBqIwBB7sgAakGHAiMAQaXJAGoQAAsjAEGgzQBqIABBAnRqIgIoAgAgA0EIaiIARgRAIAIgAygCDDYCAAsgACgCACICBEAgAiADKAIMNgIECyADKAIMIgIEQCACIAAoAgA2AgAjAEGkzsACaigCACEFCyABIAEoAgAgAygCAEF+cWo2AgAgAyAFRgRAIwBBpM7AAmohAAUgBiADKAIAQQF2akEEaiEACwwCCwUgBwRAIwBBpM7AAmohAAwCBSMAQe3MAGojAEHuyABqQdwCIwBB0cwAahAACwsMAQsgACABNgIACyABEDUPCwsgAwRAIAMoAgAiAUEBcUUEQCABQQF2QXhqIgFFBEAjAEHlyABqIwBB7sgAakGCAiMAQaXJAGoQAAtBHyABQQggAUEISxsiAWdrQQEgARsiAUF9akEdTwRAIwBBtskAaiMAQe7IAGpBhwIjAEGlyQBqEAALIwBBoM0AaiABQQJ0aiICKAIAIANBCGoiAUYEQCACIAMoAgw2AgALIAEoAgAiAgRAIAIgAygCDDYCBAsgAygCDCICBEAgAiABKAIANgIAIwBBpM7AAmooAgAhBQsgACAAKAIAIAMoAgBBfnFqNgIAIAMgBUYEfyMAQaTOwAJqBSAGIAMoAgBBAXZqQQRqCyAANgIAIAAQNQ8LCyAAEDULEAAgAEUEQA8LIABBeGoQNwvlCQEFfyABRSECAkACQCAARQRAIAINASABEDIiAEUEQAJAAkAjAEGkzsACaigCACIARQ0AIAAoAgAiAkEBcQ0AIAAgAkEBcjYCACACQQF2QXhqIgJFBEAjAEHlyABqIwBB7sgAakGCAiMAQaXJAGoQAAtBHyACQQggAkEISxsiAmdrQQEgAhsiAkF9akEdTwRAIwBBtskAaiMAQe7IAGpBhwIjAEGlyQBqEAALIwBBoM0AaiACQQJ0aiIEKAIAIABBCGoiAkYEQCAEIAAoAgw2AgALIAIoAgAiBARAIAQgACgCDDYCBAsgACgCDCIABEAgACACKAIANgIACyABEDNFIwBBpM7AAmooAgAhAARAIAAgACgCAEF+cTYCAAwFCwwBCyABEDQhAAsgAEUNAgsgACgCAEEBdiAAakEAEAFLBEAjAEHwyQBqIwBB7sgAakG3BiMAQYzKAGoQAAsgACgCAEEBcUUEQCMAQZzKAGojAEHuyABqQc4BIwBBrsoAahAACyAAQQhqDwsgAEF4aiEEIAIEQCAEEDcMAQsgBCgCACICQQFxRQRAIwBBnMoAaiMAQe7IAGpB0AYjAEGCzQBqEAALIAJBAXYiA0F4aiABTw0BIAMgBGohAyAEIwBBpM7AAmooAgAiBUcEQCADKAIAIgZBAXFFBEAgBkEBdkF4aiICRQRAIwBB5cgAaiMAQe7IAGpBggIjAEGlyQBqEAALQR8gAkEIIAJBCEsbIgJna0EBIAIbIgJBfWpBHU8EQCMAQbbJAGojAEHuyABqQYcCIwBBpckAahAACyMAQaDNAGogAkECdGoiBigCACADQQhqIgJGBEAgBiADKAIMNgIACyACKAIAIgYEQCAGIAMoAgw2AgQLIAMoAgwiBgRAIAYgAigCADYCAAsgBCAEKAIAIAMoAgBBfnFqIgI2AgAgAyAFRgRAIwBBpM7AAmogBDYCAAUgAyADKAIAQQF2aiAENgIECwsLIAJBAXZBeGogAU8NASABEDIiAkEARyEDIANBAXMjAEGkzsACaigCACAERnEEQCABEDMEQCAADwsLIANFBEACQAJAIwBBpM7AAmooAgAiAkUNACACKAIAIgNBAXENACACIANBAXI2AgAgA0EBdkF4aiIDRQRAIwBB5cgAaiMAQe7IAGpBggIjAEGlyQBqEAALQR8gA0EIIANBCEsbIgNna0EBIAMbIgNBfWpBHU8EQCMAQbbJAGojAEHuyABqQYcCIwBBpckAahAACyMAQaDNAGogA0ECdGoiBSgCACACQQhqIgNGBEAgBSACKAIMNgIACyADKAIAIgUEQCAFIAIoAgw2AgQLIAIoAgwiAgRAIAIgAygCADYCAAsgARAzRSMAQaTOwAJqKAIAIQIEQCACIAIoAgBBfnE2AgAMBAsMAQsgARA0IQILIAJFDQELIAIoAgBBAXFFBEAjAEGcygBqIwBB7sgAakHOASMAQa7KAGoQAAsgBCgCACIDQQFxRQRAIwBBnMoAaiMAQe7IAGpBzgEjAEGuygBqEAALIAJBCGoiBSAAIAEgA0EBdkF4aiIAIAAgAUsbEDoaIAQQNyACKAIAQQFxBEAgBQ8FIwBBnMoAaiMAQe7IAGpBzgEjAEGuygBqEAALQQAPC0EADwsgBCACQQFyNgIAIAQgARA2IAAL+woBCH8gAkEARyABQQNxQQBHcQR/IAAhAwN/IANBAWohBCADIAEsAAA6AAAgAUEBaiIBQQNxQQBHIAJBf2oiAkEAR3EEfyAEIQMMAQUgBAsLBSAACyIDQQNxRQRAIAJBD0sEfyACQXBqIgVBcHEiB0EQaiIIIANqIAIhBCABIQIDQCADIAIoAgA2AgAgAyACKAIENgIEIAMgAigCCDYCCCADIAIoAgw2AgwgAkEQaiECIANBEGohAyAEQXBqIgRBD0sNAAshAyABIAhqIQEgBSAHawUgAgsiBEEIcQR/IAMgASgCADYCACADIAEoAgQ2AgQgA0EIaiEDIAFBCGoFIAELIQIgBEEEcQR/IAMgAigCADYCACACQQRqIQIgA0EEagUgAwshASAEQQJxBEAgASACLAAAOgAAIAEgAiwAAToAASABQQJqIQEgAkECaiECCyAEQQFxRQRAIAAPCyABIAIsAAA6AAAgAA8LIAJBH0sEQAJAAkACQAJAIANBA3FBAWsOAwABAgMLIAMgASgCACIFOgAAIAMgASwAAToAASADIAEsAAI6AAIgAkFsakFwcSIIQRNqIgkgAWogAkFtaiADQQNqIQQgAkF9aiEGIAFBA2ohAiAFIQEDQCAEIAIoAgEiBUEIdCABQRh2cjYCACAEIAIoAgUiAUEIdCAFQRh2cjYCBCAEIAIoAgkiBUEIdCABQRh2cjYCCCAEIAIoAg0iAUEIdCAFQRh2cjYCDCACQRBqIQIgBEEQaiEEIAZBcGoiBkEQSw0ACyADIAlqIQMgCGshAiEBDAILIAMgASgCACIFOgAAIAMgASwAAToAASACQWxqQXBxIghBEmoiCSABaiACQW5qIANBAmohBCACQX5qIQYgAUECaiECIAUhAQNAIAQgAigCAiIFQRB0IAFBEHZyNgIAIAQgAigCBiIBQRB0IAVBEHZyNgIEIAQgAigCCiIFQRB0IAFBEHZyNgIIIAQgAigCDiIBQRB0IAVBEHZyNgIMIAJBEGohAiAEQRBqIQQgBkFwaiIGQRFLDQALIAMgCWohAyAIayECIQEMAQsgAyABKAIAIgU6AAAgAkFsakFwcSIIQRFqIgkgAWogAkFvaiADQQFqIQQgAkF/aiEGIAFBAWohAiAFIQEDQCAEIAIoAgMiBUEYdCABQQh2cjYCACAEIAIoAgciAUEYdCAFQQh2cjYCBCAEIAIoAgsiBUEYdCABQQh2cjYCCCAEIAIoAg8iAUEYdCAFQQh2cjYCDCACQRBqIQIgBEEQaiEEIAZBcGoiBkESSw0ACyADIAlqIQMgCGshAiEBCwsgAkEQcQRAIAMgASwAADoAACADIAEsAAE6AAEgAyABLAACOgACIAMgASwAAzoAAyADIAEsAAQ6AAQgAyABLAAFOgAFIAMgASwABjoABiADIAEsAAc6AAcgAyABLAAIOgAIIAMgASwACToACSADIAEsAAo6AAogAyABLAALOgALIAMgASwADDoADCADIAEsAA06AA0gAyABLAAOOgAOIAMgASwADzoADyADQRBqIQMgAUEQaiEBCyACQQhxBEAgAyABLAAAOgAAIAMgASwAAToAASADIAEsAAI6AAIgAyABLAADOgADIAMgASwABDoABCADIAEsAAU6AAUgAyABLAAGOgAGIAMgASwABzoAByADQQhqIQMgAUEIaiEBCyACQQRxBEAgAyABLAAAOgAAIAMgASwAAToAASADIAEsAAI6AAIgAyABLAADOgADIANBBGohAyABQQRqIQELIAJBAnEEQCADIAEsAAA6AAAgAyABLAABOgABIANBAmohAyABQQJqIQELIAJBAXFFBEAgAA8LIAMgASwAADoAACAAC8ADAQZ/IAAgAUYEQCAADwsgASACaiAASyAAIAJqIgUgAUtxRQRAIAAgASACEDoaIAAPCyABIAAiA3NBA3FFIQQgAyABSQR/IAQEQCADQQNxBEAC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JCQkJCQkAAAAAQIRAAAAAAAAAAAAAAAAAAECAwQFBhEAAAAAAAAAAAABAgMEBQYHCAkKCwwNDhEAAQMFBgcICQoLDA0ODxARAAECBAUGBwgJCgsMDQ4PEQABAgMEBQYHCAkKCwwNDg8DAAEFBQABBwcAAAMJAAEKDwAABB8AAAU/AAAGfwAAB/8AAAj/AQAJ/wMACv8HAAv/DwAM/x8ADf8/AA7/fwAP//8AEAAAAAAAAAAAAAAAAAAAAALqX5YBMIpCAQgIDFtbW15bXnNpemUgPiAwAEQ6L3Nydi9lbXNkay9lbXNjcmlwdGVuLzEuMzguNS9zeXN0ZW0vbGliL2VtbWFsbG9jLmNwcABnZXRGcmVlTGlzdEluZGV4AE1JTl9GUkVFTElTVF9JTkRFWCA8PSBpbmRleCAmJiBpbmRleCA8IE1BWF9GUkVFTElTVF9JTkRFWABnZXRBZnRlcihyZWdpb24pIDw9IHNicmsoMCkAZW1tYWxsb2NfbWFsbG9jAHJlZ2lvbi0+Z2V0VXNlZCgpAGdldFBheWxvYWQAKGNoYXIqKWV4dHJhUHRyID09IChjaGFyKilwdHIgKyBzYnJrU2l6ZQBhbGxvY2F0ZVJlZ2lvbgAhbGFzdFJlZ2lvbgAhZmlyc3RSZWdpb24AZmlyc3RSZWdpb24AcHRyID09IGdldEFmdGVyKGxhc3RSZWdpb24pAGV4dGVuZExhc3RSZWdpb24AYWRkVG9GcmVlTGlzdABnZXRCaWdFbm91Z2hGcmVlTGlzdEluZGV4AHBheWxvYWRTaXplID49IHNpemUAcG9zc2libHlTcGxpdFJlbWFpbmRlcgBleHRyYSA+PSBNSU5fUkVHSU9OX1NJWkUAdG90YWxTcGxpdFNpemUgPj0gTUlOX1JFR0lPTl9TSVpFAG1lcmdlSW50b0V4aXN0aW5nRnJlZVJlZ2lvbgByZWdpb24gPT0gbGFzdFJlZ2lvbgBlbW1hbGxvY19yZWFsbG9j";
