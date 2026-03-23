const canvas = document.getElementById("glcanvas");
const info = document.getElementById("info");
const gl = canvas.getContext("webgl");

if (!gl) {
	throw new Error("WebGL не поддерживается в этом браузере.");
}

const VERTEX_SHADER_SOURCE = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUV;
attribute vec3 aTangent;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform mat3 uNormalMatrix;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUV;
varying vec3 vTangent;

void main() {
	vec4 worldPos = uModel * vec4(aPosition, 1.0);
	vWorldPos = worldPos.xyz;
	vNormal = normalize(uNormalMatrix * aNormal);
	vUV = aUV;
	vTangent = normalize(uNormalMatrix * aTangent);
	gl_Position = uProjection * uView * worldPos;
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision mediump float;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUV;
varying vec3 vTangent;

uniform sampler2D uDiffuse;
uniform sampler2D uHeightMap;
uniform vec3 uLightPos;
uniform vec3 uViewPos;
uniform vec3 uAmbientColor;
uniform vec3 uLightColor;
uniform float uShininess;
uniform float uBumpStrength;
uniform vec2 uHeightTexel;

void main() {
	vec3 normal = normalize(vNormal);
	vec3 tangent = normalize(vTangent - normal * dot(vTangent, normal));
	vec3 bitangent = normalize(cross(normal, tangent));

	float hL = texture2D(uHeightMap, vUV - vec2(uHeightTexel.x, 0.0)).r;
	float hR = texture2D(uHeightMap, vUV + vec2(uHeightTexel.x, 0.0)).r;
	float hD = texture2D(uHeightMap, vUV - vec2(0.0, uHeightTexel.y)).r;
	float hU = texture2D(uHeightMap, vUV + vec2(0.0, uHeightTexel.y)).r;

	float dHdU = hR - hL;
	float dHdV = hU - hD;
	vec3 bumpedNormal = normalize(normal + uBumpStrength * (dHdU * tangent + dHdV * bitangent));

	vec3 lightDir = normalize(uLightPos - vWorldPos);
	vec3 viewDir = normalize(uViewPos - vWorldPos);
	vec3 reflectDir = reflect(-lightDir, bumpedNormal);

	vec4 texColor = texture2D(uDiffuse, vUV);
	vec3 ambient = uAmbientColor * texColor.rgb;

	float diff = max(dot(bumpedNormal, lightDir), 0.0);
	vec3 diffuse = diff * texColor.rgb * uLightColor;

	float spec = pow(max(dot(viewDir, reflectDir), 0.0), uShininess);
	vec3 specular = 0.35 * spec * uLightColor;

	vec3 color = ambient + diffuse + specular;
	gl_FragColor = vec4(color, texColor.a);
}
`;

function createShader(glContext, type, source) {
	const shader = glContext.createShader(type);
	glContext.shaderSource(shader, source);
	glContext.compileShader(shader);

	if (!glContext.getShaderParameter(shader, glContext.COMPILE_STATUS)) {
		const log = glContext.getShaderInfoLog(shader);
		glContext.deleteShader(shader);
		throw new Error("Ошибка компиляции шейдера: " + log);
	}

	return shader;
}

function createProgram(glContext, vertexSource, fragmentSource) {
	const vertexShader = createShader(glContext, glContext.VERTEX_SHADER, vertexSource);
	const fragmentShader = createShader(glContext, glContext.FRAGMENT_SHADER, fragmentSource);

	const program = glContext.createProgram();
	glContext.attachShader(program, vertexShader);
	glContext.attachShader(program, fragmentShader);
	glContext.linkProgram(program);

	if (!glContext.getProgramParameter(program, glContext.LINK_STATUS)) {
		const log = glContext.getProgramInfoLog(program);
		glContext.deleteProgram(program);
		throw new Error("Ошибка линковки программы: " + log);
	}

	return program;
}

function perspective(out, fovy, aspect, near, far) {
	const f = 1.0 / Math.tan(fovy / 2.0);
	out[0] = f / aspect;
	out[1] = 0;
	out[2] = 0;
	out[3] = 0;

	out[4] = 0;
	out[5] = f;
	out[6] = 0;
	out[7] = 0;

	out[8] = 0;
	out[9] = 0;
	out[10] = (far + near) / (near - far);
	out[11] = -1;

	out[12] = 0;
	out[13] = 0;
	out[14] = (2 * far * near) / (near - far);
	out[15] = 0;
}

function lookAt(out, eye, center, up) {
	let zx = eye[0] - center[0];
	let zy = eye[1] - center[1];
	let zz = eye[2] - center[2];
	const zLen = Math.hypot(zx, zy, zz) || 1;
	zx /= zLen;
	zy /= zLen;
	zz /= zLen;

	let xx = up[1] * zz - up[2] * zy;
	let xy = up[2] * zx - up[0] * zz;
	let xz = up[0] * zy - up[1] * zx;
	const xLen = Math.hypot(xx, xy, xz) || 1;
	xx /= xLen;
	xy /= xLen;
	xz /= xLen;

	const yx = zy * xz - zz * xy;
	const yy = zz * xx - zx * xz;
	const yz = zx * xy - zy * xx;

	out[0] = xx;
	out[1] = yx;
	out[2] = zx;
	out[3] = 0;

	out[4] = xy;
	out[5] = yy;
	out[6] = zy;
	out[7] = 0;

	out[8] = xz;
	out[9] = yz;
	out[10] = zz;
	out[11] = 0;

	out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
	out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
	out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
	out[15] = 1;
}

function identity4(out) {
	out[0] = 1;
	out[1] = 0;
	out[2] = 0;
	out[3] = 0;
	out[4] = 0;
	out[5] = 1;
	out[6] = 0;
	out[7] = 0;
	out[8] = 0;
	out[9] = 0;
	out[10] = 1;
	out[11] = 0;
	out[12] = 0;
	out[13] = 0;
	out[14] = 0;
	out[15] = 1;
}

function rotateY(out, rad) {
	const c = Math.cos(rad);
	const s = Math.sin(rad);
	identity4(out);
	out[0] = c;
	out[2] = -s;
	out[8] = s;
	out[10] = c;
}

function mat3FromMat4(out, m) {
	out[0] = m[0];
	out[1] = m[1];
	out[2] = m[2];
	out[3] = m[4];
	out[4] = m[5];
	out[5] = m[6];
	out[6] = m[8];
	out[7] = m[9];
	out[8] = m[10];
}

function loadTexture(glContext, url) {
	return new Promise((resolve, reject) => {
		const texture = glContext.createTexture();
		glContext.bindTexture(glContext.TEXTURE_2D, texture);
		glContext.texImage2D(
			glContext.TEXTURE_2D,
			0,
			glContext.RGBA,
			1,
			1,
			0,
			glContext.RGBA,
			glContext.UNSIGNED_BYTE,
			new Uint8Array([255, 255, 255, 255])
		);

		const image = new Image();
		image.onload = () => {
			glContext.bindTexture(glContext.TEXTURE_2D, texture);
			glContext.pixelStorei(glContext.UNPACK_FLIP_Y_WEBGL, true);
			glContext.texImage2D(
				glContext.TEXTURE_2D,
				0,
				glContext.RGBA,
				glContext.RGBA,
				glContext.UNSIGNED_BYTE,
				image
			);

			const isPowerOfTwo = (n) => (n & (n - 1)) === 0;
			if (isPowerOfTwo(image.width) && isPowerOfTwo(image.height)) {
				glContext.generateMipmap(glContext.TEXTURE_2D);
				glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_MIN_FILTER, glContext.LINEAR_MIPMAP_LINEAR);
			} else {
				glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_WRAP_S, glContext.CLAMP_TO_EDGE);
				glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_WRAP_T, glContext.CLAMP_TO_EDGE);
				glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_MIN_FILTER, glContext.LINEAR);
			}

			glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_MAG_FILTER, glContext.LINEAR);
			resolve(texture);
		};

		image.onerror = () => reject(new Error("Не удалось загрузить текстуру: " + url));
		image.src = url;
	});
}

function generateUVFromPosition(position) {
	const x = position[0];
	const y = position[1];
	const z = position[2];
	const u = 0.5 + Math.atan2(z, x) / (2 * Math.PI);
	const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI;
	return [u, v];
}

function parseOBJ(text) {
	const positions = [];
	const normals = [];
	const uvs = [];

	const finalPositions = [];
	const finalNormals = [];
	const finalUVs = [];
	const indices = [];
	const vertexMap = new Map();

	const lines = text.split(/\r?\n/);

	function resolveIndex(index, arrayLength) {
		return index >= 0 ? index - 1 : arrayLength + index;
	}

	function pushVertex(token) {
		let mapped = vertexMap.get(token);
		if (mapped !== undefined) {
			return mapped;
		}

		const parts = token.split("/");
		const pIndex = resolveIndex(parseInt(parts[0], 10), positions.length);
		const tIndex = parts[1] ? resolveIndex(parseInt(parts[1], 10), uvs.length) : -1;
		const nIndex = parts[2] ? resolveIndex(parseInt(parts[2], 10), normals.length) : -1;

		const p = positions[pIndex];
		const n = nIndex >= 0 ? normals[nIndex] : [p[0], p[1], p[2]];
		const uv = tIndex >= 0 && uvs[tIndex] ? uvs[tIndex] : generateUVFromPosition(p);

		finalPositions.push(p[0], p[1], p[2]);
		finalNormals.push(n[0], n[1], n[2]);
		finalUVs.push(uv[0], uv[1]);

		mapped = finalPositions.length / 3 - 1;
		vertexMap.set(token, mapped);
		return mapped;
	}

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) {
			continue;
		}

		const parts = line.split(/\s+/);
		const type = parts[0];

		if (type === "v") {
			positions.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
		} else if (type === "vn") {
			normals.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
		} else if (type === "vt") {
			uvs.push([parseFloat(parts[1]), parseFloat(parts[2])]);
		} else if (type === "f") {
			const verts = parts.slice(1);
			for (let i = 1; i < verts.length - 1; i += 1) {
				const i0 = pushVertex(verts[0]);
				const i1 = pushVertex(verts[i]);
				const i2 = pushVertex(verts[i + 1]);
				indices.push(i0, i1, i2);
			}
		}
	}

	return {
		positions: new Float32Array(finalPositions),
		normals: new Float32Array(finalNormals),
		uvs: new Float32Array(finalUVs),
		indices: new Uint16Array(indices),
		tangents: buildTangents(new Float32Array(finalPositions), new Float32Array(finalNormals), new Float32Array(finalUVs), new Uint16Array(indices))
	};
}

function buildTangents(positions, normals, uvs, indices) {
	const vertexCount = positions.length / 3;
	const tanAccum = new Float32Array(vertexCount * 3);

	for (let i = 0; i < indices.length; i += 3) {
		const i0 = indices[i];
		const i1 = indices[i + 1];
		const i2 = indices[i + 2];

		const p0x = positions[i0 * 3 + 0];
		const p0y = positions[i0 * 3 + 1];
		const p0z = positions[i0 * 3 + 2];
		const p1x = positions[i1 * 3 + 0];
		const p1y = positions[i1 * 3 + 1];
		const p1z = positions[i1 * 3 + 2];
		const p2x = positions[i2 * 3 + 0];
		const p2y = positions[i2 * 3 + 1];
		const p2z = positions[i2 * 3 + 2];

		const uv0x = uvs[i0 * 2 + 0];
		const uv0y = uvs[i0 * 2 + 1];
		const uv1x = uvs[i1 * 2 + 0];
		const uv1y = uvs[i1 * 2 + 1];
		const uv2x = uvs[i2 * 2 + 0];
		const uv2y = uvs[i2 * 2 + 1];

		const e1x = p1x - p0x;
		const e1y = p1y - p0y;
		const e1z = p1z - p0z;
		const e2x = p2x - p0x;
		const e2y = p2y - p0y;
		const e2z = p2z - p0z;

		const dUV1x = uv1x - uv0x;
		const dUV1y = uv1y - uv0y;
		const dUV2x = uv2x - uv0x;
		const dUV2y = uv2y - uv0y;

		const det = dUV1x * dUV2y - dUV1y * dUV2x;
		if (Math.abs(det) < 1e-8) {
			continue;
		}

		const invDet = 1.0 / det;
		const tx = invDet * (dUV2y * e1x - dUV1y * e2x);
		const ty = invDet * (dUV2y * e1y - dUV1y * e2y);
		const tz = invDet * (dUV2y * e1z - dUV1y * e2z);

		tanAccum[i0 * 3 + 0] += tx;
		tanAccum[i0 * 3 + 1] += ty;
		tanAccum[i0 * 3 + 2] += tz;
		tanAccum[i1 * 3 + 0] += tx;
		tanAccum[i1 * 3 + 1] += ty;
		tanAccum[i1 * 3 + 2] += tz;
		tanAccum[i2 * 3 + 0] += tx;
		tanAccum[i2 * 3 + 1] += ty;
		tanAccum[i2 * 3 + 2] += tz;
	}

	const tangents = new Float32Array(vertexCount * 3);
	for (let i = 0; i < vertexCount; i += 1) {
		const nx = normals[i * 3 + 0];
		const ny = normals[i * 3 + 1];
		const nz = normals[i * 3 + 2];

		let tx = tanAccum[i * 3 + 0];
		let ty = tanAccum[i * 3 + 1];
		let tz = tanAccum[i * 3 + 2];

		const ndott = nx * tx + ny * ty + nz * tz;
		tx -= nx * ndott;
		ty -= ny * ndott;
		tz -= nz * ndott;

		let len = Math.hypot(tx, ty, tz);
		if (len < 1e-6) {
			if (Math.abs(ny) < 0.99) {
				tx = -nz;
				ty = 0;
				tz = nx;
			} else {
				tx = 1;
				ty = 0;
				tz = 0;
			}
			len = Math.hypot(tx, ty, tz);
		}

		tangents[i * 3 + 0] = tx / len;
		tangents[i * 3 + 1] = ty / len;
		tangents[i * 3 + 2] = tz / len;
	}

	return tangents;
}

function createBuffer(glContext, target, data, usage) {
	const buffer = glContext.createBuffer();
	glContext.bindBuffer(target, buffer);
	glContext.bufferData(target, data, usage);
	return buffer;
}

async function init() {
	const objText = await fetch("models/sphere.obj").then((r) => {
		if (!r.ok) {
			throw new Error("Не удалось загрузить OBJ: " + r.status);
		}
		return r.text();
	});

	const mesh = parseOBJ(objText);
	if (mesh.indices.length > 65535) {
		throw new Error("Слишком много индексов для Uint16, нужен OES_element_index_uint.");
	}

	const program = createProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
	gl.useProgram(program);

	const positionBuffer = createBuffer(gl, gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
	const normalBuffer = createBuffer(gl, gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
	const uvBuffer = createBuffer(gl, gl.ARRAY_BUFFER, mesh.uvs, gl.STATIC_DRAW);
	const tangentBuffer = createBuffer(gl, gl.ARRAY_BUFFER, mesh.tangents, gl.STATIC_DRAW);
	const indexBuffer = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

	const aPosition = gl.getAttribLocation(program, "aPosition");
	const aNormal = gl.getAttribLocation(program, "aNormal");
	const aUV = gl.getAttribLocation(program, "aUV");
	const aTangent = gl.getAttribLocation(program, "aTangent");

	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.enableVertexAttribArray(aPosition);
	gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
	gl.enableVertexAttribArray(aNormal);
	gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
	gl.enableVertexAttribArray(aUV);
	gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, tangentBuffer);
	gl.enableVertexAttribArray(aTangent);
	gl.vertexAttribPointer(aTangent, 3, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

	const texture = await loadTexture(gl, "textures/food_0022_color_1k.jpg");
	const heightTexture = await loadTexture(gl, "textures/food_0022_ao_1k.jpg");

	const uModel = gl.getUniformLocation(program, "uModel");
	const uView = gl.getUniformLocation(program, "uView");
	const uProjection = gl.getUniformLocation(program, "uProjection");
	const uNormalMatrix = gl.getUniformLocation(program, "uNormalMatrix");
	const uDiffuse = gl.getUniformLocation(program, "uDiffuse");
	const uHeightMap = gl.getUniformLocation(program, "uHeightMap");
	const uLightPos = gl.getUniformLocation(program, "uLightPos");
	const uViewPos = gl.getUniformLocation(program, "uViewPos");
	const uAmbientColor = gl.getUniformLocation(program, "uAmbientColor");
	const uLightColor = gl.getUniformLocation(program, "uLightColor");
	const uShininess = gl.getUniformLocation(program, "uShininess");
	const uBumpStrength = gl.getUniformLocation(program, "uBumpStrength");
	const uHeightTexel = gl.getUniformLocation(program, "uHeightTexel");

	const model = new Float32Array(16);
	const view = new Float32Array(16);
	const projection = new Float32Array(16);
	const normalMatrix = new Float32Array(9);

	const cameraPos = [0, 0.3, 3.2];
	const lightPos = [2.5, 2.0, 2.0];

	function resize() {
		const dpr = window.devicePixelRatio || 1;
		const width = Math.floor(window.innerWidth * dpr);
		const height = Math.floor(window.innerHeight * dpr);
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
			gl.viewport(0, 0, width, height);
		}
	}

	window.addEventListener("resize", resize);
	resize();

	gl.enable(gl.DEPTH_TEST);
	gl.clearColor(0.05, 0.06, 0.09, 1.0);

	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.uniform1i(uDiffuse, 0);
	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D, heightTexture);
	gl.uniform1i(uHeightMap, 1);
	gl.uniform3fv(uLightPos, lightPos);
	gl.uniform3fv(uViewPos, cameraPos);
	gl.uniform3fv(uAmbientColor, new Float32Array([0.2, 0.2, 0.2]));
	gl.uniform3fv(uLightColor, new Float32Array([1.0, 1.0, 1.0]));
	gl.uniform1f(uShininess, 48.0);
	let bumpStrength = 3.0;
	gl.uniform1f(uBumpStrength, bumpStrength);
	gl.uniform2fv(uHeightTexel, new Float32Array([1 / 1024, 1 / 1024]));

	lookAt(view, cameraPos, [0, 0, 0], [0, 1, 0]);
	gl.uniformMatrix4fv(uView, false, view);

	// Keyboard controls for bump strength
	window.addEventListener("keydown", (e) => {
		if (e.key === "ArrowUp") {
			bumpStrength += 0.2;
			gl.uniform1f(uBumpStrength, bumpStrength);
			console.log("Bump strength:", bumpStrength.toFixed(2));
		} else if (e.key === "ArrowDown") {
			bumpStrength = Math.max(0, bumpStrength - 0.2);
			gl.uniform1f(uBumpStrength, bumpStrength);
			console.log("Bump strength:", bumpStrength.toFixed(2));
		}
	});

	function render(timeMs) {
		resize();

		const aspect = canvas.width / canvas.height;
		perspective(projection, (45 * Math.PI) / 180, aspect, 0.1, 100.0);
		gl.uniformMatrix4fv(uProjection, false, projection);

		const t = timeMs * 0.001;
		rotateY(model, t * 0.1);
		gl.uniformMatrix4fv(uModel, false, model);

		mat3FromMat4(normalMatrix, model);
		gl.uniformMatrix3fv(uNormalMatrix, false, normalMatrix);

		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
		requestAnimationFrame(render);
	}

	info.textContent = "Phong + bump mapping (AO): food_0022_ao_1k.jpg | Use ↑↓ arrows to adjust bump intensity";
	requestAnimationFrame(render);
}

init().catch((err) => {
	console.error(err);
	info.textContent = "Ошибка: " + err.message;
});
