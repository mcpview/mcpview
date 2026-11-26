import { Box3, Group, LoadingManager, Mesh, OrthographicCamera, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MAX_TRIANGLES = 75_000;

async function readGlb(encoded: string) {
  // The App consumes a snapshot from the tool result; block every loader URL.
  const loader = new GLTFLoader(new LoadingManager().setURLModifier(() => {
    throw new Error("The CAD snapshot must contain its geometry.");
  }));
  const bytes = Uint8Array.from(
    atob(encoded),
    (character) => character.charCodeAt(0),
  );
  return (await loader.parseAsync(bytes.buffer, "")).scene;
}

function readTriangles(model: Group) {
  const vertices: Vector3[] = [];
  const faces: number[] = [];
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const coordinates = object.geometry.getAttribute("position");
    if (!coordinates) return;
    const start = vertices.length;
    const indices = object.geometry.getIndex();
    const count = indices?.count ?? coordinates.count;
    if (count % 3 !== 0 || (faces.length + count) / 3 > MAX_TRIANGLES) {
      throw new Error("The CAD snapshot exceeds the preview geometry limit.");
    }
    for (let index = 0; index < coordinates.count; index++) {
      vertices.push(
        new Vector3().fromBufferAttribute(coordinates, index).applyMatrix4(
          object.matrixWorld,
        ),
      );
    }
    for (let index = 0; index < count; index++) {
      faces.push(start + (indices?.getX(index) ?? index));
    }
  });
  if (!faces.length) throw new Error("The CAD snapshot contains no triangles.");
  const bounds = new Box3().setFromPoints(vertices);
  const center = bounds.getCenter(new Vector3());
  const radius = bounds.getSize(new Vector3()).length() / 2;
  if (!(radius > 0) || !Number.isFinite(radius)) {
    throw new Error("The CAD snapshot has invalid bounds.");
  }
  for (const vertex of vertices) vertex.sub(center).divideScalar(radius);
  return { vertices, faces };
}

export async function mountCad(
  canvas: HTMLCanvasElement,
  encoded: string,
  signal: AbortSignal,
) {
  const { vertices, faces } = readTriangles(await readGlb(encoded));
  signal.throwIfAborted();
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The CAD canvas is unavailable.");

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  const projected = vertices.map(() => new Vector3());
  const position = new Vector3();
  const light = new Vector3(-0.3, 0.5, -1).normalize();
  const normal = new Vector3();
  const side = new Vector3();
  let heading = 0.62;
  let elevation = 0.85;
  let zoom = 1;
  let wireframe = false;
  let animation = 0;
  let drag: { id: number; x: number; y: number } | undefined;

  function draw() {
    animation = 0;
    const bounds = canvas.getBoundingClientRect();
    const scale = Math.min(globalThis.devicePixelRatio || 1, 2);
    const width = Math.round(bounds.width * scale);
    const height = Math.round(bounds.height * scale);
    if (!context || !width || !height) return;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    context.clearRect(0, 0, width, height);
    camera.position.copy(
      position.setFromSphericalCoords(4, elevation, heading),
    );
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const radius = Math.min(width, height) * 0.45 * zoom;
    for (const [index, vertex] of vertices.entries()) {
      projected[index].copy(vertex).applyMatrix4(camera.matrixWorldInverse);
    }
    const triangles = [];
    for (let index = 0; index < faces.length; index += 3) {
      const a = projected[faces[index]];
      const b = projected[faces[index + 1]];
      const c = projected[faces[index + 2]];
      normal.subVectors(b, a).cross(side.subVectors(c, a)).normalize();
      if (!wireframe && normal.z <= 0) continue;
      triangles.push({
        a,
        b,
        c,
        depth: a.z + b.z + c.z,
        tone: Math.round(55 + Math.max(0, -light.dot(normal)) * 27),
      });
    }
    triangles.sort((a, b) => a.depth - b.depth);
    const dark = document.documentElement.dataset.theme === "dark";
    context.lineJoin = "round";
    context.lineWidth = Math.max(0.8, scale * 0.6);
    for (const { a, b, c, tone } of triangles) {
      context.beginPath();
      context.moveTo(width / 2 + a.x * radius, height / 2 - a.y * radius);
      context.lineTo(width / 2 + b.x * radius, height / 2 - b.y * radius);
      context.lineTo(width / 2 + c.x * radius, height / 2 - c.y * radius);
      context.closePath();
      if (wireframe) {
        context.strokeStyle = dark ? "#ffd19c82" : "#93591073";
      } else {
        context.fillStyle = `hsl(32 72% ${dark ? tone - 5 : tone}%)`;
        context.fill();
        context.strokeStyle = context.fillStyle;
      }
      context.stroke();
    }
  }

  function redraw() {
    if (!animation) animation = requestAnimationFrame(draw);
  }
  function orbit(x: number, y: number) {
    heading -= x;
    elevation = Math.max(0.04, Math.min(Math.PI - 0.04, elevation - y));
    redraw();
  }
  function scaleZoom(factor: number) {
    zoom = Math.max(0.5, Math.min(3, zoom * factor));
    redraw();
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }, { signal });
  canvas.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    orbit((event.clientX - drag.x) * 0.012, (event.clientY - drag.y) * 0.012);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }, { signal });
  canvas.addEventListener("lostpointercapture", (event) => {
    if (drag?.id === event.pointerId) drag = undefined;
  }, { signal });
  canvas.addEventListener("keydown", (event) => {
    switch (event.key) {
      case "ArrowLeft":
        orbit(-0.16, 0);
        break;
      case "ArrowRight":
        orbit(0.16, 0);
        break;
      case "ArrowUp":
        orbit(0, -0.16);
        break;
      case "ArrowDown":
        orbit(0, 0.16);
        break;
      default:
        return;
    }
    event.preventDefault();
  }, { signal });
  const resize = new ResizeObserver(redraw);
  resize.observe(canvas);
  const theme = new MutationObserver(redraw);
  theme.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  signal.addEventListener("abort", () => {
    resize.disconnect();
    theme.disconnect();
    cancelAnimationFrame(animation);
  }, { once: true });
  redraw();

  return {
    scaleZoom,
    setWireframe(value: boolean) {
      wireframe = value;
      redraw();
    },
    reset() {
      heading = 0.62;
      elevation = 0.85;
      zoom = 1;
      redraw();
    },
  };
}
