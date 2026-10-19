/* batch.js — 区块网格合并进共享大缓冲，视锥内的可见集合按页批量提交。 */
(function () {
  'use strict';
  const MC = window.MC;

  // 与 renderer.js 的顶点布局一致：位置 3 + UV 2 + 亮度 1 + 法线 3 + 方块光 1 = 40 字节。
  const VERTEX_BYTES = 40;
  // 每页 32MB，约能装 60 个地表区块；页越少，一次多批次提交覆盖的区块越多。
  const VERTEX_PAGE_BYTES = 32 * 1024 * 1024;
  // 水面/玻璃只占很小一块，单独放一页就能按全局远近顺序一次画完。
  const TRANSPARENT_PAGE_BYTES = 8 * 1024 * 1024;
  // 每个面的索引开销固定是顶点开销的 0.15；留一点余量，避免两个分配器边界不一致。
  const INDEX_RATIO = 0.2;
  const MIN_INDEX_PAGE_BYTES = 1024 * 1024;

  /* 按字节管理空闲区间。所有尺寸都是顶点步长的整数倍，切分后无需额外对齐。 */
  class RangePool {
    constructor(capacity) {
      this.capacity = capacity;
      this.used = 0;
      this.free = [{ offset: 0, size: capacity }];
    }

    canFit(bytes) {
      if (bytes <= 0) return true;
      for (let i = 0; i < this.free.length; i++) {
        if (this.free[i].size >= bytes) return true;
      }
      return false;
    }

    /* 首次适配，失败返回 -1。 */
    alloc(bytes) {
      if (bytes <= 0) return -1;
      for (let i = 0; i < this.free.length; i++) {
        const block = this.free[i];
        if (block.size < bytes) continue;
        const offset = block.offset;
        if (block.size === bytes) this.free.splice(i, 1);
        else {
          block.offset += bytes;
          block.size -= bytes;
        }
        this.used += bytes;
        return offset;
      }
      return -1;
    }

    /* 归还区间，与相邻空闲块合并，避免长时间造景后越切越碎。 */
    release(offset, bytes) {
      if (bytes <= 0) return;
      let i = 0;
      while (i < this.free.length && this.free[i].offset < offset) i++;
      if (i > 0 && this.free[i - 1].offset + this.free[i - 1].size === offset) {
        this.free[i - 1].size += bytes;
        i--;
      } else {
        this.free.splice(i, 0, { offset, size: bytes });
      }
      if (i + 1 < this.free.length &&
          this.free[i].offset + this.free[i].size === this.free[i + 1].offset) {
        this.free[i].size += this.free[i + 1].size;
        this.free.splice(i + 1, 1);
      }
      this.used -= bytes;
    }
  }

  /* 一块共享 VBO/IBO：所有区块的顶点与索引都写在这里，绘制时只换索引偏移。 */
  class BatchPage {
    constructor(gl, vertexBytes, indexBytes) {
      this.gl = gl;
      this.vertexBytes = vertexBytes;
      this.indexBytes = indexBytes;
      this.vertices = new RangePool(vertexBytes);
      this.indices = new RangePool(indexBytes);
      this.live = 0;
      this.counts = [];
      this.offsets = [];
      this.counts32 = new Int32Array(64);
      this.offsets32 = new Int32Array(64);

      this.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, vertexBytes, gl.DYNAMIC_DRAW);
      this.ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexBytes, gl.DYNAMIC_DRAW);

      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      const stride = VERTEX_BYTES;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 20);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 24);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 36);
      // 索引缓冲绑定在 VAO 里，之后绘制只需要这一个 VAO。
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bindVertexArray(null);
    }

    canReserve(vBytes, iBytes) {
      return this.vertices.canFit(vBytes) && this.indices.canFit(iBytes);
    }

    reserve(vBytes, iBytes) {
      if (!this.canReserve(vBytes, iBytes)) return null;
      const vOffset = this.vertices.alloc(vBytes);
      if (vOffset < 0) return null;
      const iOffset = this.indices.alloc(iBytes);
      if (iOffset < 0) {
        this.vertices.release(vOffset, vBytes);
        return null;
      }
      return { vOffset, iOffset };
    }

    write(data, slot) {
      const gl = this.gl;
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, slot.vOffset, data.verts);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, slot.iOffset, data.idx);
    }

    release(slot) {
      this.vertices.release(slot.vOffset, slot.vBytes);
      this.indices.release(slot.iOffset, slot.iBytes);
      this.live--;
    }

    isEmpty() {
      return this.live <= 0;
    }

    resetBatch() {
      this.counts.length = 0;
      this.offsets.length = 0;
    }

    add(count, offset) {
      this.counts.push(count);
      this.offsets.push(offset);
    }

    /* 把这一页的可见区间打包成 multi-draw 需要的定长数组。 */
    pack() {
      const n = this.counts.length;
      if (this.counts32.length < n) {
        this.counts32 = new Int32Array(n + 16);
        this.offsets32 = new Int32Array(n + 16);
      }
      for (let i = 0; i < n; i++) {
        this.counts32[i] = this.counts[i];
        this.offsets32[i] = this.offsets[i];
      }
    }

    destroy() {
      const gl = this.gl;
      gl.deleteBuffer(this.vbo);
      gl.deleteBuffer(this.ibo);
      gl.deleteVertexArray(this.vao);
      this.vbo = this.ibo = this.vao = null;
    }
  }

  MC.VERTEX_BYTES = VERTEX_BYTES;
  MC.VERTEX_PAGE_BYTES = VERTEX_PAGE_BYTES;
  MC.TRANSPARENT_PAGE_BYTES = TRANSPARENT_PAGE_BYTES;
  MC.MIN_INDEX_PAGE_BYTES = MIN_INDEX_PAGE_BYTES;
  MC.INDEX_RATIO = INDEX_RATIO;
  MC.RangePool = RangePool;
  MC.BatchPage = BatchPage;
})();
