/* terrain-worker.js — 在后台生成方块和完整网格，主线程只负责上传。 */
self.window = self;
self.MC = { skipAtlas: true };
importScripts('noise.js?v=59', 'blocks.js?v=74', 'world.js?v=70', 'mesher.js?v=60');

let world = null;
const key = (cx, cz) => cx + ',' + cz;

self.onmessage = event => {
  const job = event.data;
  try {
    if (job.type === 'init') {
      world = new MC.World(job.seed, null);
      self.postMessage({ type: 'ready' });
    } else if (job.type === 'generate') {
      const chunk = {
        cx: job.cx, cz: job.cz,
        blocks: new Uint8Array(16 * 16 * MC.WORLD.HEIGHT), generated: false
      };
      world.generate(chunk);
      self.postMessage({ type: 'generate', cx: job.cx, cz: job.cz,
        blocks: chunk.blocks.buffer }, [chunk.blocks.buffer]);
    } else if (job.type === 'mesh') {
      const chunks = new Map();
      for (const c of job.neighbors) chunks.set(key(c.cx, c.cz), c);
      world.chunks = chunks;
      const chunk = chunks.get(key(job.cx, job.cz));
      const mesh = MC.meshChunk(world, chunk);
      const buffers = [mesh.opaque.verts.buffer, mesh.opaque.idx.buffer,
        mesh.transparent.verts.buffer, mesh.transparent.idx.buffer];
      self.postMessage({ type: 'mesh', cx: job.cx, cz: job.cz, mesh }, buffers);
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error && error.message || error) });
  }
};
