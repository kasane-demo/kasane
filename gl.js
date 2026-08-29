/*
 * KASANE — 布。
 *
 * 全画面に一枚の布を吊るして、揺らす。上辺はピン留めされていて振幅ゼロ、
 * 下へ行くほど大きく振れる。ライブラリは使わず WebGL2 を直に叩いている。
 *
 * 経糸（縦）と緯糸（横）を別々のインデックスで引き、交点に点を打つ。
 * 線幅は WebGL では 1px に固定されるが、細い織り目にはむしろ都合がいい。
 */

const VERT = `#version 300 es
precision highp float;

in vec2 aGrid;          // 0..1 の格子座標
uniform mat4  uProj;
uniform float uTime;
uniform float uAspect;
uniform float uVel;     // スクロール速度 0..1
uniform float uIntro;   // 立ち上がり 0..1
uniform vec2  uPointer; // -1..1
uniform float uPointSize;

out float vShade;
out float vFade;

// ハッシュ由来の値ノイズ
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

// 布の変位。u,v は 0..1
float cloth(vec2 uv, float t) {
  // 上辺ピン留め。下へ行くほど自由に振れる
  float hang = pow(uv.y, 1.25);

  // 少ない本数の大きな襞で吊った布に見せる。細かい皺は控えめに
  float fold  = sin(uv.x * 3.6 + t * 0.42 + uv.y * 1.2) * 0.80;
  fold       += sin(uv.x * 7.1 - t * 0.31 + uv.y * 2.4) * 0.30;
  float crease = (vnoise(vec2(uv.x * 2.2, uv.y * 1.5 - t * 0.10)) - 0.5) * 1.10;
  float fine   = (vnoise(vec2(uv.x * 7.0 + t * 0.16, uv.y * 4.5)) - 0.5) * 0.18;

  float d = (fold * 0.30 + crease + fine) * hang;

  // スクロールすると布があおられる
  d += sin(uv.y * 7.0 - t * 2.2) * 0.16 * uVel * hang;
  return d;
}

void main() {
  vec2 uv = aGrid;

  // 画面より一回り大きく取り、布の切り口が見えないようにする
  float w = 4.8 * max(uAspect, 1.0);
  float h = 3.9 / min(uAspect, 1.0);
  vec3 p = vec3((uv.x - 0.5) * w, (0.5 - uv.y) * h, 0.0);

  float t = uTime;
  float d = cloth(uv, t);
  float hang = pow(uv.y, 1.25);

  // 経糸を左右に寄せて粗密をつくる。布に見えるかどうかはここで決まる
  float sway = sin(uv.x * 4.1 + t * 0.33 + uv.y * 1.6) * 0.55
             + (vnoise(vec2(uv.x * 1.9 + t * 0.05, uv.y * 1.2)) - 0.5) * 1.5;
  p.x += sway * 0.30 * hang;

  // ポインタで引っぱる
  vec2 pw = uPointer * vec2(w, h) * 0.5;
  float dist = length(p.xy - pw);
  d -= exp(-dist * dist * 0.9) * 0.55;

  // 立ち上がりでは平らな一枚から皺が起きてくる
  p.z = d * mix(0.15, 1.0, uIntro);

  // わずかに傾けて奥行きを出す
  float ca = cos(0.20), sa = sin(0.20);
  p.yz = vec2(p.y * ca - p.z * sa, p.y * sa + p.z * ca);
  p.z -= 4.2;

  gl_Position = uProj * vec4(p, 1.0);
  gl_PointSize = uPointSize;

  // 隣を差分して傾きを取り、稜線を明るくする
  float e = 0.006;
  float dx = cloth(uv + vec2(e, 0.0), t) - d;
  float dy = cloth(uv + vec2(0.0, e), t) - d;
  // 傾きを主にすることで、面ではなく襞の稜線が光る
  float slope = clamp(length(vec2(dx, dy)) * 34.0, 0.0, 1.0);
  vShade = clamp(pow(slope, 0.75) * 0.88 + (d + 0.6) * 0.16, 0.0, 1.0);

  // 縁で溶けるように落とす
  float edge = smoothstep(0.0, 0.14, uv.x) * smoothstep(1.0, 0.86, uv.x)
             * smoothstep(0.0, 0.05, uv.y) * smoothstep(1.0, 0.88, uv.y);
  vFade = edge * uIntro;
}`;

const FRAG = `#version 300 es
precision highp float;

in float vShade;
in float vFade;
uniform float uAlpha;
out vec4 outColor;

const vec3 DEEP  = vec3(0.105, 0.042, 0.030);  /* 谷はほぼ墨まで沈める */
const vec3 SHU   = vec3(0.788, 0.267, 0.169);
const vec3 CREAM = vec3(0.937, 0.918, 0.882);

void main() {
  float s = vShade;
  /* 谷は沈んだ洗朱、稜線で洗朱、いちばん張ったところにだけ生成りが差す */
  vec3 c = mix(DEEP, SHU, smoothstep(0.06, 0.62, s));
  c = mix(c, CREAM, smoothstep(0.72, 1.0, s) * 0.6);
  float a = uAlpha * vFade;
  outColor = vec4(c * a, a);   /* 事前乗算。加算合成で墨地に重ねる */
}`;

const DUST_VERT = `#version 300 es
precision highp float;
in vec3 aSeed;             // x,y = 位置, z = 位相
uniform float uTime, uAspect, uIntro;
out float vA;
void main() {
  float w = 3.3 * max(uAspect, 1.0);
  float h = 2.5 / min(uAspect, 1.0);
  float t = uTime * 0.16 + aSeed.z * 6.28;
  // ゆっくり下に落ちながら横に流れる糸くず
  float y = fract(aSeed.y - uTime * 0.012 + aSeed.z * 0.3);
  vec2 p = vec2((aSeed.x - 0.5) * w + sin(t) * 0.14, (0.5 - y) * h);
  gl_Position = vec4(p.x / max(uAspect, 1.0) * 0.55, p.y * 0.55 / max(1.0 / min(uAspect, 1.0), 1.0), 0.0, 1.0);
  gl_PointSize = 1.0 + fract(aSeed.z * 7.3) * 2.2;
  vA = (0.18 + 0.4 * fract(aSeed.z * 3.1)) * uIntro;
}`;

const DUST_FRAG = `#version 300 es
precision highp float;
in float vA;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float m = smoothstep(0.5, 0.1, length(d));
  float a = vA * m * 0.5;
  outColor = vec4(vec3(0.937, 0.918, 0.882) * a, a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed');
  }
  return s;
}

function link(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || 'program link failed');
  }
  return p;
}

function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

/* 格子と、経糸・緯糸それぞれのインデックスを組む */
function buildGrid(cols, rows) {
  const verts = new Float32Array(cols * rows * 2);
  let k = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      verts[k++] = x / (cols - 1);
      verts[k++] = y / (rows - 1);
    }
  }
  const warp = []; // 縦
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows - 1; y++) {
      warp.push(y * cols + x, (y + 1) * cols + x);
    }
  }
  const weft = []; // 横。二本に一本だけ引いて、織りの粗密を作る
  for (let y = 0; y < rows; y += 2) {
    for (let x = 0; x < cols - 1; x++) {
      weft.push(y * cols + x, y * cols + x + 1);
    }
  }
  return { verts, warp: new Uint32Array(warp), weft: new Uint32Array(weft) };
}

/* ── 2D フォールバック。WebGL2 が無い環境向けの静止した織り目 ── */
function fallback2d(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, resize() {}, render() {}, destroy() {} };
  let w = 0, h = 0;
  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1;
    for (let i = 0; i <= 60; i++) {
      const x = (i / 60) * w;
      const amp = Math.sin(i * 0.5) * 14;
      ctx.strokeStyle = `rgba(201,68,43,${0.05 + 0.09 * Math.abs(Math.sin(i * 0.7))})`;
      ctx.beginPath();
      for (let y = 0; y <= h; y += 12) {
        const k = x + Math.sin(y / h * 3.2 + i * 0.4) * amp * (y / h);
        y === 0 ? ctx.moveTo(k, y) : ctx.lineTo(k, y);
      }
      ctx.stroke();
    }
  };
  return {
    ok: true,
    resize(cw, ch, dpr) {
      w = canvas.width = Math.round(cw * dpr);
      h = canvas.height = Math.round(ch * dpr);
      draw();
    },
    render() {},
    destroy() {},
  };
}

/**
 * 布を作る。
 * @param {HTMLCanvasElement} canvas
 * @returns {{ok:boolean, webgl:boolean, resize:Function, render:Function, destroy:Function}}
 */
export function createCloth(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power',
  });
  if (!gl) return { webgl: false, ...fallback2d(canvas) };

  let prog, dustProg;
  try {
    prog = link(gl, VERT, FRAG);
    dustProg = link(gl, DUST_VERT, DUST_FRAG);
  } catch (err) {
    console.warn('[cloth] WebGL の初期化に失敗したため 2D にさがります:', err.message);
    return { webgl: false, ...fallback2d(canvas) };
  }

  const narrow = window.matchMedia('(max-width: 720px)').matches;
  const cols = narrow ? 86 : 148;
  const rows = narrow ? 60 : 96;
  const { verts, warp, weft } = buildGrid(cols, rows);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const aGrid = gl.getAttribLocation(prog, 'aGrid');
  gl.enableVertexAttribArray(aGrid);
  gl.vertexAttribPointer(aGrid, 2, gl.FLOAT, false, 0, 0);

  const ibWarp = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibWarp);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, warp, gl.STATIC_DRAW);
  const ibWeft = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibWeft);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, weft, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  // 糸くず
  const DUST = narrow ? 70 : 140;
  const seeds = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    seeds[i * 3] = Math.random();
    seeds[i * 3 + 1] = Math.random();
    seeds[i * 3 + 2] = Math.random();
  }
  const dustVao = gl.createVertexArray();
  gl.bindVertexArray(dustVao);
  const dustVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, dustVbo);
  gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
  const aSeed = gl.getAttribLocation(dustProg, 'aSeed');
  gl.enableVertexAttribArray(aSeed);
  gl.vertexAttribPointer(aSeed, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const U = {};
  for (const n of ['uProj', 'uTime', 'uAspect', 'uVel', 'uIntro', 'uPointer', 'uAlpha', 'uPointSize']) {
    U[n] = gl.getUniformLocation(prog, n);
  }
  const DU = {};
  for (const n of ['uTime', 'uAspect', 'uIntro']) DU[n] = gl.getUniformLocation(dustProg, n);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE); // 事前乗算どうしの加算。墨地に光が透けて見える
  gl.clearColor(0, 0, 0, 0);

  let aspect = 1, proj = perspective(0.82, 1, 0.1, 100), dprCache = 1;

  return {
    ok: true,
    webgl: true,

    resize(cw, ch, dpr) {
      dprCache = dpr;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      aspect = cw / ch;
      proj = perspective(0.82, aspect, 0.1, 100);
      gl.viewport(0, 0, canvas.width, canvas.height);
    },

    /** @param {{time:number, vel:number, intro:number, px:number, py:number}} s */
    render(s) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (s.intro <= 0.001) return;

      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.uniformMatrix4fv(U.uProj, false, proj);
      gl.uniform1f(U.uTime, s.time);
      gl.uniform1f(U.uAspect, aspect);
      gl.uniform1f(U.uVel, s.vel);
      gl.uniform1f(U.uIntro, s.intro);
      gl.uniform2f(U.uPointer, s.px, s.py);
      gl.uniform1f(U.uPointSize, 1.0);

      // 経糸を主、緯糸を従、交点を点で。三層で織りに見せる
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibWarp);
      // 経糸を主役に。緯糸はほとんど見えない程度に添えるだけにする
      gl.uniform1f(U.uAlpha, 0.50);
      gl.drawElements(gl.LINES, warp.length, gl.UNSIGNED_INT, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibWeft);
      gl.uniform1f(U.uAlpha, 0.055);
      gl.drawElements(gl.LINES, weft.length, gl.UNSIGNED_INT, 0);

      gl.useProgram(dustProg);
      gl.bindVertexArray(dustVao);
      gl.uniform1f(DU.uTime, s.time);
      gl.uniform1f(DU.uAspect, aspect);
      gl.uniform1f(DU.uIntro, s.intro);
      gl.drawArrays(gl.POINTS, 0, DUST);

      gl.bindVertexArray(null);
    },

    destroy() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
