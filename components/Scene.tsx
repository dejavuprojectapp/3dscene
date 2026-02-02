
'use client';
import * as THREE from 'three';
import { EffectComposer, RenderPass, ShaderPass, UnrealBloomPass } from 'three-stdlib';

import { useEffect, useRef, useState } from 'react';

// 🎨 Shaders de alta qualidade para PLY/SPLAT - Opacity previsível + cor fiel + densidade preservada
const plyVertexShader = `
varying vec3 vColor;
uniform float uPointSize;

void main() {
  vColor = color.rgb;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

  // Tamanho controlável via uniform
  gl_PointSize = uPointSize;
}
`;

const plyFragmentShader = `
precision highp float;

uniform float uOpacity;
uniform float uBrightness;
varying vec3 vColor;

// Conversão sRGB → Linear (padrão real de engine)
vec3 srgbToLinear(vec3 c) {
  return mix(
    c / 12.92,
    pow((c + 0.055) / 1.055, vec3(2.4)),
    step(0.04045, c)
  );
}

void main() {
  vec3 color = srgbToLinear(vColor);
  
  // Aplica brilho (brightness multiplier)
  color *= uBrightness;

  // Opacity global previsível
  float alpha = uOpacity;

  // ⚠️ Para PLY RGB puro, NÃO descartamos fragmentos (preserva densidade)
  gl_FragColor = vec4(color, alpha);
}
`;

// 🌐 Shader Reflexivo com HDRI Equirectangular
const equirectangularReflectionVertexShader = `
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);

    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const equirectangularReflectionFragmentShader = `
  #define PI 3.141592653589793
  
  uniform sampler2D uEnvMap;
  uniform float uBrightness;
  uniform float uMetalness;
  uniform vec3 uMetalColor;
  uniform float uFresnelPower;
  uniform float uReflectionStrength;
  uniform float uUseMetal;
  uniform float uTime;
  
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  // ===== NOISE PROCEDURAL (SEM TEXTURA) =====
  // Hash - gera pseudo-aleatório determinístico
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // Noise - interpolação perlin-like
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    // Smoothstep para interpolação suave
    vec2 u = f * f * (3.0 - 2.0 * f);
    
    float ab = mix(a, b, u.x);
    float cd = mix(c, d, u.x);
    return mix(ab, cd, u.y);
  }

  // Direção → UV equiretangular
  vec2 equirectangularUV(vec3 dir) {
    dir = normalize(dir);
    float phi = atan(dir.z, dir.x);
    float theta = acos(clamp(dir.y, -1.0, 1.0));

    return vec2(
      phi / (2.0 * PI) + 0.5,
      1.0 - theta / PI
    );
  }

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(vViewDir);

    // ===== EFEITO BURACO NEGRO (Black Hole) COM NOISE =====
    // 1️⃣ EDGE DETECTION - Fresnel com espessura em pixels (fwidth)
    float edgeFresnel = 1.0 - clamp(dot(N, V), 0.0, 1.0);
    float edge = smoothstep(0.35, 0.85, edgeFresnel);
    
    // Espessura constante em pixels usando fwidth - RESTRITO ÀS EDGES
    float edgeWidth = fwidth(edge) * 4.0;
    float edgeMask = smoothstep(0.0, edgeWidth, edge);
    float edgeRestriction = smoothstep(0.5, 1.0, edge); // Restringe o efeito muito mais para perto das edges

    // 2️⃣ NOISE PROCEDURAL ORGÂNICO
    // Noise em screen-space para distorção caótica
    float n = noise(gl_FragCoord.xy * 0.15 + uTime * 0.8);
    
    // 3️⃣ WAVE COM NOISE - Padrão mais orgânico
    float waveNoise = sin(edge * 22.0 + n * 6.283 + uTime * 2.0);
    
    // Modula intensidade com chaos do noise
    float chaos = smoothstep(0.2, 0.8, n);
    waveNoise *= chaos;
    
    // 4️⃣ CURVA DE ENERGIA NÃO-LINEAR
    // Usa abs() para picos de intensidade + pow() para contraste
    float energy = abs(waveNoise);
    energy = pow(energy, 1.4); // Curva exponencial para mais drama

    // 5️⃣ DISTORÇÃO GRAVITACIONAL - Usando energia
    vec3 R = reflect(-V, N);
    
    // Amplitude dinâmica baseada em energia
    float distortAmount = energy * 0.12; // ~12% de distorção máxima
    float distortIntensity = edge * energy * 0.6;
    
    // Cria direção de distorção radial para dentro
    vec3 distortDir = normalize(R + N * distortIntensity);
    vec3 R_distorted = mix(R, distortDir, distortAmount);
    
    vec3 envColor = texture2D(uEnvMap, equirectangularUV(R_distorted)).rgb;

    // Fresnel (Schlick simplificado)
    float NdotV = clamp(dot(N, V), 0.0, 1.0);
    float fresnel = pow(1.0 - NdotV, uFresnelPower);

    // 6️⃣ COLOR GRADING COM ENERGY CURVE
    vec3 darkColor = vec3(0.01, 0.0, 0.03);     // Azul escuro profundo
    vec3 brightColor = vec3(0.9, 0.6, 1.2);     // Magenta/Rosa brilhante
    vec3 edgeColor = mix(darkColor, brightColor, energy);

    vec3 color;
    
    if (uUseMetal > 0.5) {
      // === MODO METAL COM BURACO NEGRO CAÓTICO ===
      vec3 dielectricSpec = vec3(0.04);
      vec3 metalSpec = uMetalColor;
      vec3 specColor = mix(dielectricSpec, metalSpec, uMetalness);
      vec3 reflection = envColor * specColor;
      color = reflection * mix(0.25, 1.0, fresnel);
      color *= uBrightness;
      
      // Aplica efeito buraco negro restrito às edges (30% do efeito original)
      color = mix(color, edgeColor, edgeRestriction * energy * 0.3);
      
    } else {
      // === MODO REFLEXÃO SIMPLES COM BURACO NEGRO CAÓTICO ===
      color = envColor * mix(0.6, 1.0, fresnel) * uReflectionStrength;
      
      // Aplica efeito buraco negro restrito às edges (30% do efeito original)
      color = mix(color, edgeColor, edgeRestriction * energy * 0.3);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ====================================
// 🌪️ PARTICLE SYSTEM SHADERS
// ====================================

// 1️⃣ MASK PASS - Renderiza silhueta branca
const particleMaskVertexShader = `
  void main() {
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;

const particleMaskFragmentShader = `
  void main() {
    gl_FragColor = vec4(1.0); // Branco sólido
  }
`;

// 2️⃣ EDGE DETECTION PASS
const particleEdgeVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const particleEdgeFragmentShader = `
  uniform sampler2D tMask;
  uniform vec2 resolution;
  
  varying vec2 vUv;

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution;
    float center = texture2D(tMask, uv).r;

    float edge = 0.0;
    float px = 1.0 / resolution.x;
    float py = 1.0 / resolution.y;

    edge += abs(center - texture2D(tMask, uv + vec2(px, 0.0)).r);
    edge += abs(center - texture2D(tMask, uv + vec2(-px, 0.0)).r);
    edge += abs(center - texture2D(tMask, uv + vec2(0.0, py)).r);
    edge += abs(center - texture2D(tMask, uv + vec2(0.0, -py)).r);

    edge = smoothstep(0.05, 0.2, edge);

    gl_FragColor = vec4(edge);
  }
`;

// 3️⃣ PARTICLE PASS - Curl Noise + Vórtice + Burst Emission
const particleVertexShader = `
  #define PI 3.141592653589793

  uniform sampler2D tEdge;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uParticleDensity;
  uniform float uVortexStrength;
  uniform float uCurlStrength;
  uniform float uParticleSpeed;
  uniform float uBurstStrength;    // ex: 3.0 - força do burst inicial
  uniform float uSettleTime;       // ex: 1.5 - tempo até estabilizar (segundos)
  uniform float uAttractorStrength; // 0.0 - 2.0 - força de atração orbital
  uniform float uOrbitDistance;     // 0.5 - 2.0 - distância orbital do centro
  uniform float uOrbitSpeed;        // 0.5 - 3.0 - velocidade de rotação orbital

  attribute vec2 aSeed;
  attribute float aLife;

  varying float vLife;
  varying float vEmission;
  varying vec3 vColor;

  // Hash - pseudo-aleatório determinístico
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // Noise - interpolação Perlin-like
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) +
           (c - a) * u.y * (1.0 - u.x) +
           (d - b) * u.x * u.y;
  }

  // Curl Noise 2D (campo sem divergência)
  vec2 curlNoise(vec2 p) {
    float eps = 0.1;
    float n1 = noise(p + vec2(0.0, eps));
    float n2 = noise(p - vec2(0.0, eps));
    float n3 = noise(p + vec2(eps, 0.0));
    float n4 = noise(p - vec2(eps, 0.0));

    float dx = (n1 - n2) / (2.0 * eps);
    float dy = (n3 - n4) / (2.0 * eps);

    return normalize(vec2(dy, -dx));
  }

  // Curva de emissão: burst no início → steady depois
  float emissionCurve(float t) {
    // Decaimento exponencial do burst
    float burst = exp(-t * 2.5);
    // Mix: se t <= uSettleTime, usa burst; senão, vai para 1.0 (constante)
    return mix(1.0, burst * uBurstStrength, step(t, uSettleTime));
  }

  void main() {
    // Idade da partícula (com variação por seed para não ficar sincronizado)
    float age = mod(uTime + aSeed.x * 10.0, 10.0);
    
    // Ciclo de vida com influência da emissão
    vLife = fract(aLife + uTime * 0.3);
    
    // Curva de emissão: controla intensidade ao longo do tempo
    vEmission = emissionCurve(age);

    vec2 uv = aSeed;

    // ⚡ OTIMIZAÇÃO: Todas as partículas já estão nas edges (não precisa verificar)
    // Se você quiser re-habilitar verificação, descomente:
    // float edge = texture2D(tEdge, uv).r;
    // if (edge < 0.1) {
    //   gl_PointSize = 0.0;
    //   gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
    //   return;
    // }

    // Centro da tela (atractor)
    vec2 center = vec2(0.5);
    vec2 dir = uv - center;
    float dist = length(dir) + 0.0001;

    // Campo de vórtice: rotação + sucção
    vec2 tangent = vec2(-dir.y, dir.x);
    vec2 vortex = tangent * uVortexStrength * 0.4 - normalize(dir) * 0.3;

    // Curl noise orgânico
    vec2 curl = curlNoise(uv * 6.0 + uTime * 0.8) * uCurlStrength;

    // ✨ CAMPO DE ATRAÇÃO ORBITAL
    // Distância desejada da órbita (varia com seed para órbitas em diferentes alturas)
    float targetOrbitDist = uOrbitDistance * (0.7 + aSeed.x * 0.6);
    float distDiff = dist - targetOrbitDist;
    
    // Força de atração: puxa para a órbita ideal (não para o centro)
    vec2 attractorForce = -normalize(dir) * distDiff * uAttractorStrength * 2.0;
    
    // Velocidade orbital tangencial (rotação suave ao redor do objeto)
    float orbitPhase = aSeed.y * 6.283 + uTime * uOrbitSpeed;
    vec2 orbitTangent = vec2(-dir.y, dir.x);
    vec2 orbitalMotion = orbitTangent * uOrbitSpeed * 0.3;
    
    // Perturbação suave com curl noise para movimento orgânico
    vec2 perturbation = curl * 0.3;

    // Campo de fluxo combinado: blend entre vortex e orbital
    vec2 vortexFlow = vortex + curl;
    vec2 orbitalFlow = attractorForce + orbitalMotion + perturbation;
    
    // Mix baseado na força do attractor (0 = só vortex, 1 = só orbital)
    float attractorBlend = smoothstep(0.0, 1.0, uAttractorStrength);
    vec2 flow = mix(vortexFlow, orbitalFlow, attractorBlend);

    // Trajetória: segue o campo de fluxo
    vec2 pos = uv + flow * vLife * uParticleSpeed;

    // CRITICAL FIX: Converte de screen space [0,1] para world space
    // Usa automáticos do Three.js (projectionMatrix, modelViewMatrix)
    vec3 worldPos = vec3(pos * 2.0 - 1.0, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);

    // Tamanho: maior no início, menor no fim, amplificado pelo burst
    gl_PointSize = mix(8.0, 0.5, vLife) * vEmission;

    // Cor: do escuro para magenta brilhante
    vColor = mix(
      vec3(0.05, 0.0, 0.15),  // Azul escuro
      vec3(1.0, 0.6, 1.2),    // Magenta/Rosa
      1.0 - vLife
    );
  }
`;

const particleFragmentShader = `
  precision highp float;

  varying float vLife;
  varying float vEmission;
  varying vec3 vColor;

  void main() {
    // Circle mask usando gl_PointCoord
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);

    // Smooth circle
    float alpha = smoothstep(0.5, 0.0, d);
    // Fade-out no final da vida
    alpha *= smoothstep(1.0, 0.6, vLife);

    // Amplifica cor e brilho durante o burst
    vec3 finalColor = vColor * vEmission;

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

interface SceneProps {
  modelPaths: string[];
  texturePath?: string | null;
}

interface DebugInfo {
  camera: { x: number; y: number; z: number };
  cameraRotation: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
  viewport: {
    width: number;
    height: number;
    aspect: number;
    fov: number;
    near: number;
    far: number;
    frustumWidth: number;
    frustumHeight: number;
    distanceToOrigin: number;
    visibleArea: number;
  };
  objects: Array<{ 
    name: string; 
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
  }>;
}

// Tipo para material com shader compilado
interface PBRMaterialWithShader extends THREE.MeshStandardMaterial {
  __shader?: THREE.WebGLProgramParametersWithUniforms;
}


export default function Scene({ modelPaths, texturePath }: SceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [useARCamera, setUseARCamera] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [bgTextureEnabled, setBgTextureEnabled] = useState(false); // Controla se a textura de fundo está ativa
  const sceneRef = useRef<THREE.Scene | null>(null); // Ref para a cena Three.js
  const bgTextureRef = useRef<THREE.Texture | null>(null); // Ref para a textura de fundo carregada
  const sceneObjectsRef = useRef<Array<{ name: string; object: THREE.Object3D; targetPosition: { x: number; y: number; z: number }; opacity: number; visible: boolean; brightness?: number }>>([]);
  const cameraARRef = useRef<THREE.PerspectiveCamera | null>(null);
  const deviceOrientationRef = useRef({ alpha: 0, beta: 0, gamma: 0 });
  const debugInfoRef = useRef<DebugInfo>({
    camera: { x: 0, y: 0, z: 0 },
    cameraRotation: { x: 0, y: 0, z: 0 },
    lookAt: { x: 0, y: 0, z: 0 },
    viewport: {
      width: 0,
      height: 0,
      aspect: 0,
      fov: 0,
      near: 0,
      far: 0,
      frustumWidth: 0,
      frustumHeight: 0,
      distanceToOrigin: 0,
      visibleArea: 0,
    },
    objects: [],
  });
  const [debugInfo, setDebugInfo] = useState<DebugInfo>(debugInfoRef.current);
  const [showCameraPrompt, setShowCameraPrompt] = useState(true);
  const [showDebugOverlay, setShowDebugOverlay] = useState(true);
  const [sceneEnabled, setSceneEnabled] = useState(false); // Controla se a cena está ativa (inicia desabilitada)
  const deviceMotionRef = useRef({ x: 0, y: 0, z: 0 });
  const initialOrientationRef = useRef({ alpha: 0, beta: 0, gamma: 0 });
  const isInitialOrientationSet = useRef(false);
  const sceneInitialized = useRef(false); // Flag para prevenir múltiplas inicializações
  const sceneHasStartedOnce = useRef(false); // Flag para controlar se a cena já foi iniciada uma vez
  const cleanupFunctionsRef = useRef<(() => void)[]>([]); // Ref para funções de cleanup
  const [savedCameras, setSavedCameras] = useState<Array<{
    id: number;
    name: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    lookAt: { x: number; y: number; z: number };
  }>>([]);
  const activeCameraRef = useRef<THREE.Camera | null>(null); // Ref para a câmera ativa
  const [isAnimating, setIsAnimating] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const animationProgressRef = useRef(0);
  const animationDurationRef = useRef(5000); // Duração total da animação em ms
  const [vignetteOffset, setVignetteOffset] = useState(1.1);
  const [vignetteDarkness, setVignetteDarkness] = useState(1.3);
  const vignettePassRef = useRef<ShaderPass | null>(null);
  // Bloom
  const [bloomEnabled, setBloomEnabled] = useState(true);
  const [bloomIntensity, setBloomIntensity] = useState(1.5);
  const [bloomThreshold, setBloomThreshold] = useState(0.2);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  // Luzes
  const [ambientIntensity, setAmbientIntensity] = useState(1.5);
  const [pointIntensity, setPointIntensity] = useState(2);
  const [directionalIntensity, setDirectionalIntensity] = useState(1.5);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const pointLightRef = useRef<THREE.PointLight | null>(null);
  const directionalLightRef = useRef<THREE.DirectionalLight | null>(null);

  // 🌐 Shader Reflexivo com HDRI Equirectangular
  const equirectGLBsRef = useRef<Map<string, THREE.ShaderMaterial>>(new Map());
  const equirectOriginalSidesRef = useRef<Map<string, THREE.Side>>(new Map());
  const equirectHDRIRef = useRef<THREE.Texture | null>(null);
  const [equirectGLBs, setEquirectGLBs] = useState<Set<string>>(new Set());
  const [equirectFresnelPower, setEquirectFresnelPower] = useState(5.0);
  const [equirectBrightness, setEquirectBrightness] = useState(1.0);
  const [equirectMetalness, setEquirectMetalness] = useState(1.0);
  const [equirectMetalColor, setEquirectMetalColor] = useState(new THREE.Color(1.0, 0.85, 0.55)); // Gold default
  const [equirectUseMetal, setEquirectUseMetal] = useState(true); // Checkbox para habilitar metal
  const [equirectReflectionStrength, setEquirectReflectionStrength] = useState(1.0); // Para modo simples

  // 🎨 Referências para materiais PBR dos GLBs (MeshStandardMaterial com onBeforeCompile)
  const glbPbrMaterialsRef = useRef<Map<string, PBRMaterialWithShader>>(new Map());
  const shaderTimeRef = useRef(0);

  // 🌪️ PARTICLE SYSTEM REFS & STATES
  const particleSystemsRef = useRef<Map<string, {
    mask: THREE.WebGLRenderTarget;
    edge: THREE.WebGLRenderTarget;
    material: THREE.ShaderMaterial;
    geometry: THREE.BufferGeometry;
    points: THREE.Points;
  }>>(new Map());
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  const [particlesEnabled, setParticlesEnabled] = useState(true);
  const [particleDensity, setParticleDensity] = useState(1.0); // 0.5 - 2.0
  const [particleSpeed, setParticleSpeed] = useState(0.8); // 0.3 - 1.5
  const [particleVortexStrength, setParticleVortexStrength] = useState(1.0); // 0.3 - 2.0
  const [particleCurlStrength, setParticleCurlStrength] = useState(1.0); // 0.3 - 2.0
  const [particleSize, setParticleSize] = useState(1.0); // 0.3 - 2.0
  const [particleBurstStrength, setParticleBurstStrength] = useState(3.0); // 0.5 - 5.0
  const [particleSettleTime, setParticleSettleTime] = useState(1.5); // 0.5 - 3.0 (segundos)
  const [particleAttractorStrength, setParticleAttractorStrength] = useState(0.0); // 0.0 - 2.0 (0 = vortex, 2 = orbital forte)
  const [particleOrbitDistance, setParticleOrbitDistance] = useState(1.2); // 0.5 - 2.0 (raio da órbita)
  const [particleOrbitSpeed, setParticleOrbitSpeed] = useState(1.0); // 0.5 - 3.0 (velocidade de rotação)
  const [particleFollowCamera, setParticleFollowCamera] = useState(true); // Partículas seguem rotação da câmera
  const [debugEdgeTexture, setDebugEdgeTexture] = useState(false); // Debug: renderiza edge texture

  // --- HOOKS DEVEM FICAR AQUI, NO TOPO DO COMPONENTE ---
  useEffect(() => {
    if (vignettePassRef.current) {
      vignettePassRef.current.uniforms['offset'].value = vignetteOffset;
      vignettePassRef.current.uniforms['darkness'].value = vignetteDarkness;
    }
  }, [vignetteOffset, vignetteDarkness]);

  useEffect(() => {
    if (ambientLightRef.current) ambientLightRef.current.intensity = ambientIntensity;
  }, [ambientIntensity]);

  useEffect(() => {
    if (pointLightRef.current) pointLightRef.current.intensity = pointIntensity;
  }, [pointIntensity]);

  useEffect(() => {
    if (directionalLightRef.current) directionalLightRef.current.intensity = directionalIntensity;
  }, [directionalIntensity]);

  // Log das luzes da cena sempre que a intensidade mudar
  useEffect(() => {
    const lightsInfo = [
      { name: '🟡 AmbientLight', intensity: ambientIntensity },
      { name: '🟠 PointLight', intensity: pointIntensity },
      { name: '⚪ DirectionalLight', intensity: directionalIntensity }
    ];
    
    console.group('💡 LUZES DA CENA');
    console.table(lightsInfo);
    console.log('Total de luzes:', lightsInfo.length);
    console.groupEnd();
  }, [ambientIntensity, pointIntensity, directionalIntensity]);

  // Desativa bloom quando AR camera está ativa
  useEffect(() => {
    if (bloomPassRef.current) {
      if (useARCamera) {
        bloomPassRef.current.enabled = false;
        console.log('🌟 Bloom desativado (AR Camera ativa)');
      } else if (bloomEnabled) {
        bloomPassRef.current.enabled = true;
        console.log('🌟 Bloom ativado');
      }
    }
  }, [useARCamera, bloomEnabled]);

  // Atualiza intensidade do bloom
  useEffect(() => {
    if (bloomPassRef.current && !useARCamera) {
      bloomPassRef.current.strength = bloomIntensity;
    }
  }, [bloomIntensity, useARCamera]);

  // Atualiza threshold do bloom
  useEffect(() => {
    if (bloomPassRef.current && !useARCamera) {
      bloomPassRef.current.threshold = bloomThreshold;
    }
  }, [bloomThreshold, useARCamera]);

  // 🌐 Atualiza Fresnel Power do shader equirectangular
  useEffect(() => {
    equirectGLBsRef.current.forEach((material) => {
      material.uniforms.uFresnelPower.value = equirectFresnelPower;
    });
  }, [equirectFresnelPower]);

  // 🌐 Atualiza Brightness do shader equirectangular
  useEffect(() => {
    equirectGLBsRef.current.forEach((material) => {
      material.uniforms.uBrightness.value = equirectBrightness;
    });
  }, [equirectBrightness]);

  // 🌐 Atualiza Metalness do shader equirectangular
  useEffect(() => {
    equirectGLBsRef.current.forEach((material) => {
      material.uniforms.uMetalness.value = equirectMetalness;
    });
  }, [equirectMetalness]);

  // 🌐 Atualiza Metal Color do shader equirectangular
  useEffect(() => {
    equirectGLBsRef.current.forEach((material) => {
      material.uniforms.uMetalColor.value.copy(equirectMetalColor);
    });
  }, [equirectMetalColor]);

  // 🌐 Atualiza Use Metal do shader equirectangular
  useEffect(() => {
    equirectGLBsRef.current.forEach((material) => {
      material.uniforms.uUseMetal.value = equirectUseMetal ? 1.0 : 0.0;
    });
  }, [equirectUseMetal]);

  // 🌐 Atualiza Reflection Strength do shader equirectangular (modo simples)
  useEffect(() => {
    equirectGLBsRef.current.forEach((material) => {
      material.uniforms.uReflectionStrength.value = equirectReflectionStrength;
    });
  }, [equirectReflectionStrength]);

  // 🌐 Atualiza Time do shader equirectangular + Particle systems (para animação de onda)
  useEffect(() => {
    let animationFrameId: number;
    const startTime = performance.now();

    const updateTime = () => {
      const elapsed = (performance.now() - startTime) / 1000; // Converte para segundos
      shaderTimeRef.current = elapsed;
      
      equirectGLBsRef.current.forEach((material) => {
        material.uniforms.uTime.value = elapsed;
      });

      // Atualiza também o time das partículas
      particleSystemsRef.current.forEach((system) => {
        system.material.uniforms.uTime.value = elapsed;
      });
      
      animationFrameId = requestAnimationFrame(updateTime);
    };

    animationFrameId = requestAnimationFrame(updateTime);

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, []);

  // 🌪️ Atualiza densidade das partículas
  useEffect(() => {
    particleSystemsRef.current.forEach((system) => {
      system.material.uniforms.uParticleDensity.value = particleDensity;
    });
  }, [particleDensity]);

  // 🌪️ Atualiza velocidade das partículas
  useEffect(() => {
    particleSystemsRef.current.forEach((system) => {
      system.material.uniforms.uParticleSpeed.value = particleSpeed;
    });
  }, [particleSpeed]);

  // 🌪️ Atualiza força do vórtice
  useEffect(() => {
    particleSystemsRef.current.forEach((system) => {
      system.material.uniforms.uVortexStrength.value = particleVortexStrength;
    });
  }, [particleVortexStrength]);

  // 🌪️ Atualiza força do curl noise
  useEffect(() => {
    particleSystemsRef.current.forEach((system) => {
      system.material.uniforms.uCurlStrength.value = particleCurlStrength;
    });
  }, [particleCurlStrength]);

  // 🌪️ Atualiza força do burst (emissão inicial)
  useEffect(() => {
    particleSystemsRef.current.forEach((system) => {
      system.material.uniforms.uBurstStrength.value = particleBurstStrength;
    });
  }, [particleBurstStrength]);

  // 🌪️ Atualiza tempo de estabilização do burst
  useEffect(() => {
    particleSystemsRef.current.forEach((system) => {
      system.material.uniforms.uSettleTime.value = particleSettleTime;
    });
  }, [particleSettleTime]);

  // 🌪️ Atualiza força de atração orbital
  useEffect(() => {
    particleSystemsRef.current.forEach((system) => {
      system.material.uniforms.uAttractorStrength.value = particleAttractorStrength;
    });
  }, [particleAttractorStrength]);

  // 🌪️ Atualiza distância orbital
  useEffect(() => {
    particleSystemsRef.current.forEach((system) => {
      system.material.uniforms.uOrbitDistance.value = particleOrbitDistance;
    });
  }, [particleOrbitDistance]);

  // 🌪️ Atualiza velocidade orbital
  useEffect(() => {
    particleSystemsRef.current.forEach((system) => {
      system.material.uniforms.uOrbitSpeed.value = particleOrbitSpeed;
    });
  }, [particleOrbitSpeed]);

  // 🔍 DEBUG: Toggle edge texture visualization
  useEffect(() => {
    if (debugEdgeTexture) {
      // Encontra o primeiro sistema de partículas e visualiza sua edge texture
      const firstKey = particleSystemsRef.current.keys().next().value;
      if (firstKey) {
        debugRenderEdgeTexture(firstKey, true);
      } else {
        console.warn('⚠️ Nenhum sistema de partículas ativo para debug');
      }
    } else {
      // Remove visualização debug
      const firstKey = particleSystemsRef.current.keys().next().value;
      if (firstKey) {
        debugRenderEdgeTexture(firstKey, false);
      }
    }
  }, [debugEdgeTexture]);

  // Função para atualizar a posição de um objeto com smooth transition
  const updateObjectPosition = (objectName: string, axis: 'x' | 'y' | 'z', value: number) => {
    const objData = sceneObjectsRef.current.find(obj => obj.name === objectName);
    if (objData) {
      objData.targetPosition[axis] = value;
      console.log(`🎯 Target posição: ${objectName} - ${axis.toUpperCase()}: ${value}`);
    } else {
      console.error(`❌ Objeto não encontrado: ${objectName}`);
    }
  };

  // Função helper para aplicar opacity baseada no tipo de arquivo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyObjectOpacity = (object: any, objectName: string, opacity: number) => {
    const fileExt = objectName.toLowerCase().split('.').pop();
    const isPlyOrSplat = fileExt === 'ply' || fileExt === 'splat';
    
    if (isPlyOrSplat) {
      // 💎 PLY/SPLAT: Aplica no uniform uOpacity do ShaderMaterial
      if (object.material && object.material.uniforms && object.material.uniforms.uOpacity) {
        object.material.uniforms.uOpacity.value = opacity;
      }
    } else {
      // 📦 GLB: Aplica no material padrão (lógica original)
      if (object.material) {
        if (Array.isArray(object.material)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          object.material.forEach((mat: any) => {
            mat.opacity = opacity;
            mat.transparent = opacity < 1;
          });
        } else {
          object.material.opacity = opacity;
          object.material.transparent = opacity < 1;
        }
      }
      // Para GLB com children
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      object.traverse((child: any) => {
        if (child.material) {
          if (Array.isArray(child.material)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            child.material.forEach((mat: any) => {
              mat.opacity = opacity;
              mat.transparent = opacity < 1;
            });
          } else {
            child.material.opacity = opacity;
            child.material.transparent = opacity < 1;
          }
        }
      });
    }
  };

  // Função para atualizar a opacidade de um objeto
  // 🎛 Roteamento correto: .ply/.splat → uOpacity uniform | .glb → uAlpha uniform
  const updateObjectOpacity = (objectName: string, opacity: number) => {
    const objData = sceneObjectsRef.current.find(obj => obj.name === objectName);
    if (objData) {
      objData.opacity = Math.max(0, Math.min(1, opacity)); // Clamp entre 0 e 1
      
      // Detecta tipo de arquivo
      const fileExt = objectName.toLowerCase().split('.').pop();
      const isPlyOrSplat = fileExt === 'ply' || fileExt === 'splat';
      
      if (isPlyOrSplat && (objData.object instanceof THREE.Points || objData.object instanceof THREE.Mesh)) {
        // 💎 PLY/SPLAT: Controla uOpacity uniform no ShaderMaterial
        const material = (objData.object as THREE.Points | THREE.Mesh).material as THREE.ShaderMaterial;
        if (material && material.uniforms && material.uniforms.uOpacity) {
          material.uniforms.uOpacity.value = objData.opacity;
          console.log(`🎨 PLY/SPLAT Opacity: ${objectName} = ${objData.opacity.toFixed(2)} (uniform)`);
        }
      } else {
        // 📦 GLB: Atualiza uAlpha uniform no shader injetado
        objData.object.traverse((child: THREE.Object3D) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh && mesh.material) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat) => {
              const matWithUniforms = mat as THREE.Material & { uniforms?: Record<string, { value: number }> };
              if (mat && matWithUniforms.uniforms && matWithUniforms.uniforms.uAlpha) {
                matWithUniforms.uniforms.uAlpha.value = objData.opacity;
              }
            });
          }
        });
        console.log(`🎨 GLB Opacity: ${objectName} = ${objData.opacity.toFixed(2)} (uniform uAlpha)`);
      }
    } else {
      console.error(`❌ Objeto não encontrado: ${objectName}`);
    }
  };

  // 🎨 Função para aplicar shader customizado ao GLB usando onBeforeCompile
  const applyPBRShaderToGLB = (mesh: THREE.Mesh, objectName: string) => {
    // Extrai propriedades do material original
    let originalOpacity = 1.0;
    
    // Suporta múltiplos tipos de materiais
    const originalMaterial = mesh.material;
    if (originalMaterial && !Array.isArray(originalMaterial)) {
      const mat = originalMaterial as THREE.Material & { opacity?: number };
      
      // Copia a opacidade original
      if (mat.opacity !== undefined) {
        originalOpacity = mat.opacity;
      }
      
      // Log detalhado do material
      const matWithMap = originalMaterial as THREE.Material & { map?: THREE.Texture };
      console.log(`🎨 Material original: ${(mat as THREE.Material).type || 'Unknown'}`, {
        hasMap: !!matWithMap.map,
        opacity: originalOpacity,
      });
    }

    // Converte para MeshStandardMaterial se necessário (mantém textura e propriedades)
    let pbrMaterial = originalMaterial as THREE.MeshStandardMaterial;
    if (!Array.isArray(originalMaterial) && originalMaterial?.type !== 'MeshStandardMaterial' && originalMaterial?.type !== 'MeshPhysicalMaterial') {
      // Cria um novo MeshStandardMaterial com as propriedades copiadas
      const baseMat = originalMaterial as THREE.Material & { map?: THREE.Texture; color?: THREE.Color; opacity?: number; transparent?: boolean; side?: THREE.Side };
      pbrMaterial = new THREE.MeshStandardMaterial({
        color: baseMat.color,
        map: baseMat.map, // ✅ Copia a textura
        transparent: baseMat.transparent ?? true,
        opacity: baseMat.opacity ?? 1.0,
        side: baseMat.side ?? THREE.FrontSide,
      });
    } else {
      pbrMaterial = (originalMaterial as THREE.MeshStandardMaterial).clone();
    }

    // Uniforms customizados
    const uniforms = {
      uAlpha: { value: originalOpacity },
      uBrightness: { value: 1.0 },
      uTime: { value: 0 },
    };

    // ✅ Injeta os uniforms no shader padrão do Three.js
    pbrMaterial.onBeforeCompile = (shader) => {
      // Adiciona uniforms ao shader
      Object.assign(shader.uniforms, uniforms);

      // Adiciona as DECLARAÇÕES dos uniforms no início do fragment shader
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `
         uniform float uAlpha;
         uniform float uBrightness;
         uniform float uTime;
         
         void main() {`
      );

      // Injeta a lógica de alpha procedural no fragment shader
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         
         // Alpha procedural isolado - map/diffuse já foram processados acima
         // float proceduralAlpha = sin(uTime * 2.0) * 0.3 + 0.7; // Pulso 0.4-1.0
         // float customAlpha = uAlpha * proceduralAlpha;
         // gl_FragColor.a *= customAlpha;
         gl_FragColor.a *= uAlpha; // Opacidade fixa
         // Aplica brilho
         gl_FragColor.rgb *= uBrightness;`
      );

      // Armazena o material para atualizações posteriores
      const matKey = `${objectName}_${Math.random()}`;
      (pbrMaterial as PBRMaterialWithShader).__shader = shader as THREE.WebGLProgramParametersWithUniforms;
      glbPbrMaterialsRef.current.set(matKey, pbrMaterial as PBRMaterialWithShader);
    };

    // Aplica o material ao mesh
    mesh.material = pbrMaterial;
    const hasMap = (pbrMaterial as THREE.MeshStandardMaterial).map ? 'SIM' : 'NÃO';
    console.log(`✅ Shader PBR aplicado ao mesh: ${objectName} (textura: ${hasMap})`);
  };

  // Função para atualizar o brilho de um GLB
  const updateGLBBrightness = (objectName: string, brightness: number) => {
    const objData = sceneObjectsRef.current.find(obj => obj.name === objectName);
    if (objData) {
      objData.brightness = brightness;
      
      // Aplica o brilho em todos os materiais do modelo
      objData.object.traverse((child: THREE.Object3D) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && mesh.material) {
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          materials.forEach((mat) => {
            // Método 1: Ajustar color brightness (multiplica as cores)
            if ('color' in mat && mat.color && mat.color instanceof THREE.Color) {
              const userData = mat.userData as Record<string, unknown>;
              if (!(userData.originalColor instanceof THREE.Color)) {
                userData.originalColor = mat.color.clone();
              }
              mat.color.copy(userData.originalColor as THREE.Color).multiplyScalar(brightness);
            }
            // Método 2: Ajustar emissive (se o material suportar)
            if ('emissive' in mat && mat.emissive && mat.emissive instanceof THREE.Color && mat.userData) {
              const userData = mat.userData as Record<string, unknown>;
              if (!(userData.originalEmissive instanceof THREE.Color)) {
                userData.originalEmissive = mat.emissive.clone();
              }
              if (brightness > 1) {
                mat.emissive.copy((userData.originalEmissive as THREE.Color) || mat.emissive).multiplyScalar(brightness - 1);
              } else {
                mat.emissive.copy((userData.originalEmissive as THREE.Color) || mat.emissive);
              }
            }
            (mat as THREE.Material).needsUpdate = true;
          });
        }
      });
      
      console.log(`💡 GLB Brightness: ${objectName} = ${brightness.toFixed(2)}`);
    }
  };

  // 🌐 Funções de preset para metalness
  const applyMetalPreset = (presetName: string) => {
    const presets: { [key: string]: { color: THREE.Color; metalness: number; name: string } } = {
      gold: {
        color: new THREE.Color(1.0, 0.71, 0.29),
        metalness: 1.0,
        name: '🟡 Ouro'
      },
      copper: {
        color: new THREE.Color(0.95, 0.64, 0.54),
        metalness: 1.0,
        name: '🟠 Cobre'
      },
      scifiBlue: {
        color: new THREE.Color(0.6, 0.7, 1.0),
        metalness: 1.0,
        name: '🔵 Aço Azulado'
      },
      aluminum: {
        color: new THREE.Color(0.91, 0.92, 0.92),
        metalness: 0.9,
        name: '⚪ Alumínio'
      },
    };

    const preset = presets[presetName];
    if (preset) {
      setEquirectMetalColor(preset.color.clone());
      setEquirectMetalness(preset.metalness);
      console.log(`✅ Preset aplicado: ${preset.name}`);
    }
  };
  const toggleObjectVisibility = (objectName: string, visible: boolean) => {
    const objData = sceneObjectsRef.current.find(obj => obj.name === objectName);
    if (objData) {
      objData.visible = visible;
      console.log(`👁️ Visibilidade: ${objectName} = ${visible}`);
    } else {
      console.error(`❌ Objeto não encontrado: ${objectName}`);
    }
  };

  // Função para atualizar o brilho de gaussian splats (.ply/.splat)
  const updateObjectBrightness = (objectName: string, brightness: number) => {
    const objData = sceneObjectsRef.current.find(obj => obj.name === objectName);
    if (objData) {
      const fileExt = objectName.toLowerCase().split('.').pop();
      const isPlyOrSplat = fileExt === 'ply' || fileExt === 'splat';
      
      if (isPlyOrSplat && (objData.object instanceof THREE.Points || objData.object instanceof THREE.Mesh)) {
        const material = (objData.object as THREE.Points | THREE.Mesh).material as THREE.ShaderMaterial;
        if (material && material.uniforms && material.uniforms.uBrightness) {
          material.uniforms.uBrightness.value = Math.max(0, brightness); // Clamp mínimo 0
          console.log(`💡 Brilho: ${objectName} = ${brightness.toFixed(2)}x`);
        }
      } else {
        console.warn(`⚠️ Brilho só funciona com .ply/.splat: ${objectName}`);
      }
    } else {
      console.error(`❌ Objeto não encontrado: ${objectName}`);
    }
  };

  // Função para atualizar o tamanho dos pontos de gaussian splats (.ply/.splat)
  const updateObjectPointSize = (objectName: string, pointSize: number) => {
    const objData = sceneObjectsRef.current.find(obj => obj.name === objectName);
    if (objData) {
      const fileExt = objectName.toLowerCase().split('.').pop();
      const isPlyOrSplat = fileExt === 'ply' || fileExt === 'splat';
      
      if (isPlyOrSplat && (objData.object instanceof THREE.Points || objData.object instanceof THREE.Mesh)) {
        const material = (objData.object as THREE.Points | THREE.Mesh).material as THREE.ShaderMaterial;
        if (material && material.uniforms && material.uniforms.uPointSize) {
          material.uniforms.uPointSize.value = Math.max(0.1, pointSize); // Clamp mínimo 0.1
          console.log(`📏 Tamanho de Ponto: ${objectName} = ${pointSize.toFixed(1)}px`);
        }
      } else {
        console.warn(`⚠️ Tamanho de ponto só funciona com .ply/.splat: ${objectName}`);
      }
    } else {
      console.error(`❌ Objeto não encontrado: ${objectName}`);
    }
  };

  // Função para toggle background texture
  // Agora só liga/desliga o background, o environment sempre fica ativo se a textura existir
  const toggleBackgroundTexture = (enabled: boolean) => {
    if (!sceneRef.current) {
      console.error('❌ Cena não disponível');
      return;
    }
    if (bgTextureRef.current) {
      sceneRef.current.environment = bgTextureRef.current; // Sempre ativo
      if (enabled) {
        sceneRef.current.background = bgTextureRef.current;
        setBgTextureEnabled(true);
        console.log('🖼️ Background texture ativada');
      } else {
        sceneRef.current.background = null;
        setBgTextureEnabled(false);
        console.log('🔲 Background só desativada (environment ativo)');
      }
    }
  };

  // 🌐 Função para aplicar shader reflexivo com HDRI Equirectangular ao GLB
  const applyEquirectangularShaderToGLB = (mesh: THREE.Mesh, objectName: string, hdriTexture: THREE.Texture) => {
    // Armazena o side original do material antes de mudar
    const originalMaterial = mesh.material;
    let originalSide: THREE.Side = THREE.DoubleSide;
    if (originalMaterial && !Array.isArray(originalMaterial)) {
      const matWithSide = originalMaterial as THREE.Material & { side?: THREE.Side };
      if (matWithSide.side !== undefined) {
        originalSide = matWithSide.side;
      }
    }
    equirectOriginalSidesRef.current.set(objectName, originalSide);

    const equirectMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uEnvMap: { value: hdriTexture },
        uBrightness: { value: equirectBrightness },
        uMetalness: { value: equirectMetalness },
        uMetalColor: { value: equirectMetalColor.clone() },
        uFresnelPower: { value: equirectFresnelPower },
        uReflectionStrength: { value: equirectReflectionStrength },
        uUseMetal: { value: equirectUseMetal ? 1.0 : 0.0 },
        uTime: { value: 0.0 },
      },
      vertexShader: equirectangularReflectionVertexShader,
      fragmentShader: equirectangularReflectionFragmentShader,
      side: THREE.FrontSide,
      depthWrite: true,
      depthTest: true,
    });

    mesh.material = equirectMaterial;
    equirectGLBsRef.current.set(objectName, equirectMaterial);
    console.log(`🌐 Shader Equirectangular + Black Hole Effect aplicado: ${objectName}`);
  };

  // 🌐 Função para remover shader equirectangular e restaurar material original
  const removeEquirectangularShaderFromGLB = (mesh: THREE.Mesh, objectName: string) => {
    const originalMaterial = mesh.material;
    if (originalMaterial instanceof THREE.Material) {
      (originalMaterial as THREE.Material).dispose();
    }
    
    // Recupera o side original que foi armazenado
    const originalSide = equirectOriginalSidesRef.current.get(objectName) || THREE.DoubleSide;
    
    const defaultMaterial = new THREE.MeshStandardMaterial({
      color: 0x808080,
      metalness: 0.5,
      roughness: 0.5,
      side: originalSide,
    });
    
    mesh.material = defaultMaterial;
    equirectGLBsRef.current.delete(objectName);
    equirectOriginalSidesRef.current.delete(objectName);
    console.log(`🔲 Shader equirectangular + Black Hole Effect removido (side restaurado): ${objectName}`);
  };

  // 🌐 Função para toggle do shader equirectangular
  const toggleEquirectangularShader = (objectName: string, enableEquirect: boolean) => {
    const objData = sceneObjectsRef.current.find(obj => obj.name === objectName);
    if (!objData) {
      console.error(`❌ Objeto não encontrado: ${objectName}`);
      return;
    }

    let mesh: THREE.Mesh | null = null;
    
    objData.object.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh && !mesh) {
        mesh = child as THREE.Mesh;
      }
    });

    if (!mesh) {
      console.error(`❌ Nenhum mesh encontrado em: ${objectName}`);
      return;
    }

    if (enableEquirect) {
      // Prioriza usar o background texture se disponível
      if (bgTextureRef.current) {
        const bgTexture = bgTextureRef.current.clone();
        bgTexture.mapping = THREE.EquirectangularReflectionMapping;
        equirectHDRIRef.current = bgTexture;
        applyEquirectangularShaderToGLB(mesh, objectName, bgTexture);
        setEquirectGLBs(prev => new Set([...prev, objectName]));
        console.log(`✅ Background texture usado como mapa de reflexão: ${objectName}`);
        
        // 🌪️ Inicia partículas se habilitado
        if (particlesEnabled && rendererRef.current && mesh) {
          initializeParticleSystem(mesh, objectName, rendererRef.current);
        }
      } else if (!equirectHDRIRef.current) {
        // Fallback: se não tem background, tenta carregar um HDRI padrão
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(
          'https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr',
          (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            equirectHDRIRef.current = texture;
            if (mesh) {
              applyEquirectangularShaderToGLB(mesh, objectName, texture);
            }
            setEquirectGLBs(prev => new Set([...prev, objectName]));
            console.log(`✅ HDRI padrão carregado e shader aplicado: ${objectName}`);
            
            // 🌪️ Inicia partículas após shader ser aplicado
            if (particlesEnabled && rendererRef.current && mesh) {
              initializeParticleSystem(mesh, objectName, rendererRef.current);
            }
          },
          undefined,
          () => {
            // Fallback final: cria uma textura simples se falhar
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 512;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = '#444444';
              ctx.fillRect(0, 0, 1024, 512);
            }
            const texture = new THREE.CanvasTexture(canvas);
            texture.mapping = THREE.EquirectangularReflectionMapping;
            equirectHDRIRef.current = texture;
            if (mesh) {
              applyEquirectangularShaderToGLB(mesh, objectName, texture);
            }
            setEquirectGLBs(prev => new Set([...prev, objectName]));
            
            // 🌪️ Inicia partículas após shader ser aplicado
            if (particlesEnabled && rendererRef.current && mesh) {
              initializeParticleSystem(mesh, objectName, rendererRef.current);
            }
          }
        );
      } else {
        applyEquirectangularShaderToGLB(mesh, objectName, equirectHDRIRef.current);
        setEquirectGLBs(prev => new Set([...prev, objectName]));
        
        // 🌪️ Inicia partículas se habilitado
        if (particlesEnabled && rendererRef.current && mesh) {
          initializeParticleSystem(mesh, objectName, rendererRef.current);
        }
      }
    } else {
      removeEquirectangularShaderFromGLB(mesh, objectName);
      removeParticleSystem(objectName); // Remove partículas quando desabilita shader
      setEquirectGLBs(prev => {
        const next = new Set(prev);
        next.delete(objectName);
        return next;
      });
    }
  };

  // 🌪️ Função para inicializar sistema de partículas para um objeto equirectangular
  const initializeParticleSystem = async (mesh: THREE.Mesh, objectName: string, renderer: THREE.WebGLRenderer) => {
    if (!particlesEnabled) return;

    try {
      // Dimensões do render target
      const width = 1024;
      const height = 1024;

      // 1️⃣ MASK PASS - Renderiza silhueta branca
      const maskTarget = new THREE.WebGLRenderTarget(width, height);
      const maskScene = new THREE.Scene();
      maskScene.background = new THREE.Color(0x000000);

      const maskMaterial = new THREE.ShaderMaterial({
        vertexShader: particleMaskVertexShader,
        fragmentShader: particleMaskFragmentShader,
      });

      // Clona o mesh para renderizar na mask
      const maskMesh = mesh.clone();
      maskMesh.material = maskMaterial;
      maskScene.add(maskMesh);

      // Renderiza mask com câmera melhor posicionada
      const box = new THREE.Box3().setFromObject(maskMesh);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = 75;
      const distance = maxDim / (2 * Math.tan((fov * Math.PI) / 360));

      const originalCamera = new THREE.PerspectiveCamera(fov, width / height, 0.1, 1000);
      originalCamera.position.copy(center);
      originalCamera.position.z += distance * 1.5; // Um pouco mais afastado
      originalCamera.lookAt(center);

      console.log(`📐 Mask Pass - Camera dist: ${distance.toFixed(2)}, Size: ${maxDim.toFixed(2)}`);

      renderer.setRenderTarget(maskTarget);
      renderer.clear(true, true, true);
      renderer.render(maskScene, originalCamera);
      renderer.setRenderTarget(null);

      console.log(`✅ Mask Pass completa: ${objectName}`);

      // 2️⃣ EDGE DETECTION PASS
      const edgeTarget = new THREE.WebGLRenderTarget(width, height);
      const edgeScene = new THREE.Scene();
      edgeScene.background = new THREE.Color(0x000000);

      const edgeMaterial = new THREE.ShaderMaterial({
        uniforms: {
          tMask: { value: maskTarget.texture },
          resolution: { value: new THREE.Vector2(width, height) },
        },
        vertexShader: particleEdgeVertexShader,
        fragmentShader: particleEdgeFragmentShader,
      });

      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), edgeMaterial);
      edgeScene.add(quad);

      const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      renderer.setRenderTarget(edgeTarget);
      renderer.render(edgeScene, orthoCamera);
      renderer.setRenderTarget(null);

      console.log(`✅ Edge Detection Pass completa: ${objectName}`);

      // 3️⃣ LÊ PIXELS DA EDGE TEXTURE - Coleta coordenadas UV reais onde há edge
      const edgePixelData = new Uint8Array(width * height * 4);
      renderer.setRenderTarget(edgeTarget);
      renderer.readRenderTargetPixels(edgeTarget, 0, 0, width, height, edgePixelData);
      renderer.setRenderTarget(null);

      // Coleta coordenadas UV de pixels que são edge (valor R > 25)
      const edgeCoords: Array<{ u: number; v: number }> = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const edgeValue = edgePixelData[idx]; // Canal R (grayscale)
          
          if (edgeValue > 25) { // Threshold para detectar edge
            edgeCoords.push({
              u: x / width,
              v: y / height,
            });
          }
        }
      }

      console.log(`🔍 Edge pixels detectados: ${edgeCoords.length} / ${width * height}`);

      // Se não encontrou edges suficientes, usa distribuição aleatória como fallback
      const hasValidEdges = edgeCoords.length > 100;
      const particleCount = Math.floor(2048 * particleDensity);
      const geometry = new THREE.BufferGeometry();

      // Atributos: seed (UV das edges reais) e life (offset para ciclo)
      const seeds = new Float32Array(particleCount * 2);
      const lives = new Float32Array(particleCount);
      const positions = new Float32Array(particleCount * 3); // Position attribute

      for (let i = 0; i < particleCount; i++) {
        if (hasValidEdges) {
          // Escolhe aleatoriamente uma coordenada UV de edge real
          const randomEdge = edgeCoords[Math.floor(Math.random() * edgeCoords.length)];
          seeds[i * 2] = randomEdge.u;
          seeds[i * 2 + 1] = randomEdge.v;
        } else {
          // Fallback: distribuição aleatória
          seeds[i * 2] = Math.random();
          seeds[i * 2 + 1] = Math.random();
        }
        
        lives[i] = Math.random(); // offset de fase
        
        // Posições iniciais no center (0, 0, 0) - shader vai mover elas
        positions[i * 3] = 0.0;
        positions[i * 3 + 1] = 0.0;
        positions[i * 3 + 2] = 0.0;
      }

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 2));
      geometry.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));

      const particleMaterial = new THREE.ShaderMaterial({
        uniforms: {
          tEdge: { value: edgeTarget.texture },
          uTime: { value: 0.0 },
          uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
          uParticleDensity: { value: particleDensity },
          uVortexStrength: { value: particleVortexStrength },
          uCurlStrength: { value: particleCurlStrength },
          uParticleSpeed: { value: particleSpeed },
          uBurstStrength: { value: particleBurstStrength },
          uSettleTime: { value: particleSettleTime },
          uAttractorStrength: { value: particleAttractorStrength },
          uOrbitDistance: { value: particleOrbitDistance },
          uOrbitSpeed: { value: particleOrbitSpeed },
        },
        vertexShader: particleVertexShader,
        fragmentShader: particleFragmentShader,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });

      const points = new THREE.Points(geometry, particleMaterial);
      if (sceneRef.current) {
        sceneRef.current.add(points);
      }

      particleSystemsRef.current.set(objectName, {
        mask: maskTarget,
        edge: edgeTarget,
        material: particleMaterial,
        geometry: geometry,
        points: points,
      });

      console.log(`🌪️ Sistema de partículas inicializado: ${objectName}`);
      console.log(`   - Partículas: ${particleCount}`);
      console.log(`   - Posição na cena: ${points.position.toArray()}`);
      console.log(`   - Visible: ${points.visible}`);
      console.log(`   - Edge texture: ${edgeTarget.texture ? '✅ Carregada' : '❌ Não carregada'}`);
    } catch (error) {
      console.error(`❌ Erro ao inicializar sistema de partículas: ${objectName}`, error);
    }
  };

  // 🌪️ Função para limpar sistema de partículas
  const removeParticleSystem = (objectName: string) => {
    const system = particleSystemsRef.current.get(objectName);
    if (system) {
      // Limpa GPU memory
      system.mask.dispose();
      system.edge.dispose();
      system.geometry.dispose();
      system.material.dispose();

      // Remove da cena
      if (sceneRef.current) {
        sceneRef.current.remove(system.points);
      }

      particleSystemsRef.current.delete(objectName);
      console.log(`🗑️ Sistema de partículas removido: ${objectName}`);
    }
  };

  // 🔍 DEBUG: Renderiza edge texture para visualizar
  const debugRenderEdgeTexture = (objectName: string, showDebug: boolean) => {
    const system = particleSystemsRef.current.get(objectName);
    if (!system || !rendererRef.current || !sceneRef.current) {
      console.error('❌ Sistema de partículas ou renderer não encontrado');
      return;
    }

    if (showDebug) {
      // Remove debug anterior se existir
      const existingDebugMesh = sceneRef.current.getObjectByName(`__debug_edge_${objectName}`);
      if (existingDebugMesh) {
        sceneRef.current.remove(existingDebugMesh);
      }

      // Cria uma geometria grande na frente da câmera com a edge texture
      const debugGeometry = new THREE.PlaneGeometry(20, 20);
      const debugMaterial = new THREE.MeshBasicMaterial({
        map: system.edge.texture,
        side: THREE.FrontSide,
      });
      const debugMesh = new THREE.Mesh(debugGeometry, debugMaterial);
      debugMesh.name = `__debug_edge_${objectName}`;
      debugMesh.position.z = -10; // Bem perto da câmera
      
      sceneRef.current.add(debugMesh);
      console.log(`🔍 DEBUG: Edge texture renderizada para ${objectName}`);
      console.log(`   - Edge texture size: 1024x1024`);
      console.log(`   - Se estiver PRETA: mask pass falhou`);
      console.log(`   - Se estiver BRANCA: edge detection falhou`);
      console.log(`   - Se tiver CONTORNOS BRANCOS: sucesso! Partículas devem aparecer`);
    } else {
      // Remove debug mesh
      const debugMesh = sceneRef.current.getObjectByName(`__debug_edge_${objectName}`);
      if (debugMesh) {
        sceneRef.current.remove(debugMesh);
        console.log(`🔲 Debug: Edge texture removida`);
      }
    }
  };

  // (removida: não utilizada)
  // Função para atualizar a rotação de um objeto
  const updateObjectRotation = (objectName: string, axis: 'x' | 'y' | 'z', degrees: number) => {
    const objData = sceneObjectsRef.current.find(obj => obj.name === objectName);
    if (objData) {
      const radians = degrees * (Math.PI / 180);
      objData.object.rotation[axis] = radians;
      console.log(`🔄 Rotação: ${objectName} - ${axis.toUpperCase()}: ${degrees}°`);
    } else {
      console.error(`❌ Objeto não encontrado: ${objectName}`);
    }
  };

  // Função para salvar posição da câmera atual
  const saveCamera = () => {
    if (!activeCameraRef.current) {
      console.error('❌ Nenhuma câmera ativa disponível');
      return;
    }

    if (savedCameras.length >= 4) {
      console.warn('⚠️ Limite de 4 câmeras atingido');
      return;
    }

    const camera = activeCameraRef.current;
    
    const newCamera = {
      id: Date.now(),
      name: `Camera ${savedCameras.length + 1}`,
      position: {
        x: parseFloat(camera.position.x.toFixed(2)),
        y: parseFloat(camera.position.y.toFixed(2)),
        z: parseFloat(camera.position.z.toFixed(2)),
      },
      rotation: {
        x: parseFloat((camera.rotation.x * 180 / Math.PI).toFixed(1)),
        y: parseFloat((camera.rotation.y * 180 / Math.PI).toFixed(1)),
        z: parseFloat((camera.rotation.z * 180 / Math.PI).toFixed(1)),
      },
      lookAt: {
        x: debugInfo.lookAt.x,
        y: debugInfo.lookAt.y,
        z: debugInfo.lookAt.z,
      },
    };

    setSavedCameras([...savedCameras, newCamera]);
    console.log('📷 Câmera salva:', newCamera);
  };

  // Função para aplicar posição de câmera salva
  const applySavedCamera = (cameraData: typeof savedCameras[0]) => {
    if (!activeCameraRef.current) {
      console.error('❌ Nenhuma câmera ativa disponível');
      return;
    }

    const camera = activeCameraRef.current;
    camera.position.set(cameraData.position.x, cameraData.position.y, cameraData.position.z);
    camera.rotation.set(
      cameraData.rotation.x * (Math.PI / 180),
      cameraData.rotation.y * (Math.PI / 180),
      cameraData.rotation.z * (Math.PI / 180)
    );
    console.log('📷 Câmera aplicada:', cameraData.name);
  };

  // Função para deletar câmera salva
  const deleteSavedCamera = (id: number) => {
    setSavedCameras(savedCameras.filter(cam => cam.id !== id));
    console.log('🗑️ Câmera deletada:', id);
  };

  // Função para criar e iniciar animação interpolada entre câmeras
  const createCameraAnimation = () => {
    if (savedCameras.length < 2) {
      console.warn('⚠️ Precisa de pelo menos 2 câmeras salvas para criar animação');
      return;
    }

    console.log('🎬 Criando animação com', savedCameras.length, 'câmeras');
    setIsAnimating(true);
    animationProgressRef.current = 0;
  };

  // Função para parar animação
  const stopCameraAnimation = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setIsAnimating(false);
    animationProgressRef.current = 0;
    console.log('⏸️ Animação parada');
  };

  // Função de interpolação linear (lerp)
  const lerp = (start: number, end: number, t: number) => {
    return start + (end - start) * t;
  };

  // Função de interpolação esférica para rotações (slerp simplificado)
  const lerpRotation = (start: number, end: number, t: number) => {
    // Normaliza ângulos para -180 a 180
    const normalize = (angle: number) => {
      while (angle > 180) angle -= 360;
      while (angle < -180) angle += 360;
      return angle;
    };
    
    const s = normalize(start);
    const e = normalize(end);
    let diff = e - s;
    
    // Pega o caminho mais curto
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    
    return normalize(s + diff * t);
  };

  // useEffect para animar câmera
  useEffect(() => {
    if (!isAnimating || savedCameras.length < 2 || !activeCameraRef.current) {
      return;
    }

    const startTime = Date.now();
    const duration = animationDurationRef.current;
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      animationProgressRef.current = progress;

      // Calcula qual segmento da animação (entre quais câmeras)
      const totalSegments = savedCameras.length - 1;
      const segmentProgress = progress * totalSegments;
      const currentSegment = Math.min(Math.floor(segmentProgress), totalSegments - 1);
      const segmentT = segmentProgress - currentSegment;

      const startCam = savedCameras[currentSegment];
      const endCam = savedCameras[currentSegment + 1];

      // Interpola posição
      const camera = activeCameraRef.current;
      if (camera) {
        camera.position.x = lerp(startCam.position.x, endCam.position.x, segmentT);
        camera.position.y = lerp(startCam.position.y, endCam.position.y, segmentT);
        camera.position.z = lerp(startCam.position.z, endCam.position.z, segmentT);
      }

      // Interpola rotação
      const rotX = lerpRotation(startCam.rotation.x, endCam.rotation.x, segmentT);
      const rotY = lerpRotation(startCam.rotation.y, endCam.rotation.y, segmentT);
      const rotZ = lerpRotation(startCam.rotation.z, endCam.rotation.z, segmentT);
      
      if (camera) {
        camera.rotation.x = rotX * (Math.PI / 180);
        camera.rotation.y = rotY * (Math.PI / 180);
        camera.rotation.z = rotZ * (Math.PI / 180);
      }

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        console.log('✅ Animação completa');
        setIsAnimating(false);
        animationProgressRef.current = 0;
      }
    };

    animate();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isAnimating, savedCameras]);

  // Inicializa webcam/câmera traseira
  const startARCamera = async () => {
    try {
      console.log('📹 Solicitando acesso à câmera...');
      console.log('🌐 Protocolo:', window.location.protocol);
      console.log('🔍 Navigator:', {
        mediaDevices: !!navigator.mediaDevices,
        getUserMedia: !!(navigator.mediaDevices?.getUserMedia),
        userAgent: navigator.userAgent,
      });
      
      // Verifica HTTPS (obrigatório para getUserMedia)
      if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        throw new Error('HTTPS_REQUIRED');
      }
      
      // Verifica se getUserMedia está disponível
      if (!navigator.mediaDevices) {
        // Fallback para API antiga (webkit)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nav = navigator as any;
        if (nav.getUserMedia || nav.webkitGetUserMedia || nav.mozGetUserMedia || nav.msGetUserMedia) {
          throw new Error('LEGACY_API');
        }
        throw new Error('NO_MEDIA_DEVICES');
      }
      
      if (!navigator.mediaDevices.getUserMedia) {
        throw new Error('NO_GET_USER_MEDIA');
      }

      // Solicita permissão explícita
      const constraints = {
        video: {
          facingMode: 'environment', // Tenta câmera traseira primeiro
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
        audio: false,
      };

      console.log('📱 Solicitando permissão com constraints:', constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('✅ Stream obtido:', stream);

      if (!videoRef.current) {
        console.error('❌ videoRef.current não está disponível');
        throw new Error('Elemento de vídeo não encontrado');
      }

      videoRef.current.srcObject = stream;
      
      // Adiciona listener para quando o metadata carregar
      videoRef.current.onloadedmetadata = async () => {
        console.log('📹 Metadata carregado');
        try {
          await videoRef.current?.play();
          setIsVideoReady(true);
          console.log('✅ Câmera iniciada com sucesso:', {
            width: videoRef.current?.videoWidth,
            height: videoRef.current?.videoHeight,
            aspect: (videoRef.current?.videoWidth || 1) / (videoRef.current?.videoHeight || 1),
          });
        } catch (playError) {
          console.error('❌ Erro ao reproduzir vídeo:', playError);
        }
      };

      videoRef.current.onerror = (error) => {
        console.error('❌ Erro no elemento de vídeo:', error);
      };

      // Solicita permissão para DeviceOrientation (iOS 13+)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const permission = await (DeviceOrientationEvent as any).requestPermission();
          if (permission === 'granted') {
            window.addEventListener('deviceorientation', handleDeviceOrientation);
            console.log('✅ Permissão DeviceOrientation concedida');
          } else {
            console.warn('⚠️ Permissão DeviceOrientation negada');
          }
        } catch (orientationError) {
          console.warn('⚠️ Erro ao solicitar DeviceOrientation:', orientationError);
        }
      } else {
        window.addEventListener('deviceorientation', handleDeviceOrientation);
        console.log('✅ DeviceOrientation listener adicionado');
      }

      // Adiciona listener para DeviceMotion (acelerômetro)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const permission = await (DeviceMotionEvent as any).requestPermission();
          if (permission === 'granted') {
            window.addEventListener('devicemotion', handleDeviceMotion);
            console.log('✅ Permissão DeviceMotion concedida');
          }
        } catch (motionError) {
          console.warn('⚠️ Erro ao solicitar DeviceMotion:', motionError);
        }
      } else {
        window.addEventListener('devicemotion', handleDeviceMotion);
        console.log('✅ DeviceMotion listener adicionado');
      }

      setUseARCamera(true);
      isInitialOrientationSet.current = false; // Reset para capturar nova orientação inicial
      console.log('✅ AR Camera ativada');
      
    } catch (error) {
      console.error('❌ Erro detalhado ao acessar câmera:', error);
      
      let errorMessage = 'Não foi possível acessar a câmera.\n\n';
      
      if (error instanceof Error) {
        // Erros customizados
        if (error.message === 'HTTPS_REQUIRED') {
          errorMessage = '🔒 HTTPS Obrigatório\n\n';
          errorMessage += 'A câmera só funciona em:\n';
          errorMessage += '• Sites HTTPS (https://...)\n';
          errorMessage += '• localhost\n\n';
          errorMessage += `Você está acessando via: ${window.location.protocol}\n\n`;
          errorMessage += '💡 Para testar no celular:\n';
          errorMessage += '1. Use um túnel HTTPS (ngrok, cloudflare tunnel)\n';
          errorMessage += '2. Ou acesse via cabo USB com port forwarding';
        } else if (error.message === 'NO_MEDIA_DEVICES') {
          errorMessage = '❌ Navegador Não Suportado\n\n';
          errorMessage += 'Seu navegador não suporta MediaDevices API.\n\n';
          errorMessage += '✅ Navegadores suportados:\n';
          errorMessage += '• Chrome/Edge 53+\n';
          errorMessage += '• Firefox 36+\n';
          errorMessage += '• Safari 11+\n\n';
          errorMessage += `Seu navegador: ${navigator.userAgent}`;
        } else if (error.message === 'NO_GET_USER_MEDIA') {
          errorMessage = '❌ getUserMedia Não Disponível\n\n';
          errorMessage += 'Seu navegador não suporta getUserMedia.\n\n';
          errorMessage += '💡 Tente atualizar seu navegador para a versão mais recente.';
        } else if (error.message === 'LEGACY_API') {
          errorMessage = '⚠️ API Antiga Detectada\n\n';
          errorMessage += 'Seu navegador usa uma versão antiga da API de câmera.\n\n';
          errorMessage += '💡 Por favor, atualize seu navegador.';
        } else if (error.name === 'NotAllowedError') {
          errorMessage = '🚫 Permissão Negada\n\n';
          errorMessage += 'Você bloqueou o acesso à câmera.\n\n';
          errorMessage += '✅ Para permitir:\n';
          errorMessage += '1. Toque no ícone 🔒 ou ⓘ na barra de endereços\n';
          errorMessage += '2. Ative "Câmera"\n';
          errorMessage += '3. Recarregue a página';
        } else if (error.name === 'NotFoundError') {
          errorMessage = '❌ Câmera Não Encontrada\n\n';
          errorMessage += 'Nenhuma câmera foi detectada no seu dispositivo.';
        } else if (error.name === 'NotReadableError') {
          errorMessage = '⚠️ Câmera em Uso\n\n';
          errorMessage += 'A câmera está sendo usada por outro aplicativo.\n\n';
          errorMessage += '💡 Feche outros apps que possam estar usando a câmera.';
        } else if (error.name === 'OverconstrainedError') {
          errorMessage += '❌ Configurações de câmera não suportadas. Tentando novamente com configurações básicas...';
          
          // Tenta novamente com configurações mais simples
          try {
            const simpleStream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
            
            if (videoRef.current) {
              videoRef.current.srcObject = simpleStream;
              await videoRef.current.play();
              setIsVideoReady(true);
              setUseARCamera(true);
              console.log('✅ Câmera iniciada com configurações básicas');
              return;
            }
          } catch (retryError) {
            console.error('❌ Falha na segunda tentativa:', retryError);
          }
        } else {
          errorMessage += `Erro: ${error.message}`;
        }
      }
      
      alert(errorMessage);
      setShowCameraPrompt(false);
    }
  };

  const stopARCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    window.removeEventListener('deviceorientation', handleDeviceOrientation);
    window.removeEventListener('devicemotion', handleDeviceMotion);
    setUseARCamera(false);
    setIsVideoReady(false);
    isInitialOrientationSet.current = false;
  };

  const handleDeviceOrientation = (event: DeviceOrientationEvent) => {
    // Salva orientação inicial como referência
    if (!isInitialOrientationSet.current && useARCamera) {
      initialOrientationRef.current = {
        alpha: event.alpha || 0,
        beta: event.beta || 0,
        gamma: event.gamma || 0,
      };
      isInitialOrientationSet.current = true;
      console.log('📍 Orientação inicial definida:', initialOrientationRef.current);
    }

    deviceOrientationRef.current = {
      alpha: event.alpha || 0,  // yaw (rotação Z)
      beta: event.beta || 0,    // pitch (rotação X)
      gamma: event.gamma || 0,  // roll (rotação Y)
    };
  };

  const handleDeviceMotion = (event: DeviceMotionEvent) => {
    if (event.accelerationIncludingGravity && useARCamera) {
      // Aceleração com gravidade (m/s²)
      const acc = event.accelerationIncludingGravity;
      deviceMotionRef.current = {
        x: acc.x || 0,
        y: acc.y || 0,
        z: acc.z || 0,
      };
    }
  };

  // 🗑️ Função para limpar múltiplas cenas e objetos duplicados
  const deleteMultipleScenesAndDuplicates = () => {
    console.log('🧹 Iniciando limpeza de múltiplas cenas e duplicados...');
    
    if (!containerRef.current) {
      console.log('⚠️ Container não disponível para limpeza');
      return;
    }

    // 1. Remove todos os canvas existentes (múltiplas cenas)
    const canvasElements = containerRef.current.querySelectorAll('canvas');
    if (canvasElements.length > 0) {
      console.log(`🗑️ Encontrados ${canvasElements.length} canvas element(s)`);
      canvasElements.forEach((canvas, index) => {
        try {
          // Tenta forçar perda de contexto WebGL
          const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
          if (gl) {
            const loseContext = gl.getExtension('WEBGL_lose_context');
            if (loseContext) {
              loseContext.loseContext();
              console.log(`  ✅ Contexto WebGL perdido do canvas ${index}`);
            }
          }
          
          // Remove do DOM
          if (canvas.parentNode) {
            canvas.parentNode.removeChild(canvas);
            console.log(`  ✅ Canvas ${index} removido do DOM`);
          }
        } catch (error) {
          console.error(`  ❌ Erro ao remover canvas ${index}:`, error);
        }
      });
    }

    // 2. Limpa objetos duplicados no sceneObjectsRef
    const uniqueObjects = new Map();
    const duplicates: string[] = [];
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sceneObjectsRef.current.forEach((item) => {
      if (uniqueObjects.has(item.name)) {
        duplicates.push(item.name);
        // Limpa o objeto duplicado
        try {
          if ((item.object instanceof THREE.Mesh || item.object instanceof THREE.Points) && item.object.geometry) {
            item.object.geometry.dispose();
          }
          if ((item.object instanceof THREE.Mesh || item.object instanceof THREE.Points) && item.object.material) {
            if (Array.isArray(item.object.material)) {
              item.object.material.forEach((mat: THREE.Material) => mat.dispose());
            } else {
              item.object.material.dispose();
            }
          }
          console.log(`  🗑️ Objeto duplicado limpo: ${item.name}`);
        } catch (error) {
          console.error(`  ❌ Erro ao limpar duplicado ${item.name}:`, error);
        }
      } else {
        uniqueObjects.set(item.name, item);
      }
    });

    if (duplicates.length > 0) {
      console.log(`🗑️ Duplicados encontrados e removidos: ${duplicates.join(', ')}`);
      // Atualiza o ref apenas com objetos únicos
      sceneObjectsRef.current = Array.from(uniqueObjects.values());
      console.log(`✅ sceneObjectsRef atualizado. Total de objetos únicos: ${sceneObjectsRef.current.length}`);
    } else {
      console.log('✅ Nenhum objeto duplicado encontrado');
    }

    console.log('✅ Limpeza de múltiplas cenas e duplicados concluída');
  };

  useEffect(() => {
    // Só inicia a cena se sceneEnabled for true, ainda não foi inicializada E não iniciou antes
    if (!containerRef.current || modelPaths.length === 0 || !sceneEnabled || sceneHasStartedOnce.current) return;

    console.log('🔄 useEffect executado. ModelPaths:', modelPaths);
    console.log('🚦 sceneInitialized.current:', sceneInitialized.current);

    // 🧹 LIMPA múltiplas cenas e duplicados ANTES de verificar inicialização
    deleteMultipleScenesAndDuplicates();

    // Previne múltiplas inicializações simultâneas
    if (sceneInitialized.current) {
      console.warn('⚠️ AVISO: Tentativa de inicializar cena duplicada bloqueada!');
      return;
    }
    
    sceneInitialized.current = true;
    sceneHasStartedOnce.current = true; // Marca que a cena já foi iniciada uma vez
    console.log('✅ Flag sceneInitialized definida como true');
    console.log('✅ Flag sceneHasStartedOnce definida como true - cena não reiniciará');
    
    // Limpa array anterior de cleanup functions
    cleanupFunctionsRef.current = [];

    const init = async () => {
      if (!containerRef.current) return;

      // 🧹 LIMPEZA PROFUNDA: Remove qualquer resíduo de objetos no container
      console.log('🧹 Limpeza profunda do container...');
      
      // Limpa objetos anteriores para evitar duplicação
      sceneObjectsRef.current = [];
      console.log('  ✅ SceneObjectsRef limpo');
      
      // Remove qualquer canvas órfão ainda presente
      const orphanCanvases = containerRef.current.querySelectorAll('canvas');
      if (orphanCanvases.length > 0) {
        console.log(`  🗑️ Removendo ${orphanCanvases.length} canvas órfão(s)...`);
        orphanCanvases.forEach(canvas => {
          canvas.remove();
        });
      }

      console.log('🔍 Estado inicial - useEffect disparado para:', modelPaths);
      console.log('🚀 Iniciando carregamento de modelos:', modelPaths);

      // Check for unsupported .spz files first
      const spzFiles = modelPaths.filter(path => {
        const ext = path.split('.').pop()?.toLowerCase();
        return ext === 'spz';
      });

      if (spzFiles.length > 0) {
        console.error('❌ ERRO: Arquivos .spz não são suportados pela biblioteca gaussian-splats-3d');
        console.error('📝 Arquivos .spz encontrados:', spzFiles);
        console.info('💡 SOLUÇÃO: Converta seus arquivos .spz para .splat usando:');
        console.info('   → SuperSplat: https://playcanvas.com/supersplat/editor');
        console.info('   → Ou renomeie para .ply se for um Point Cloud');
      }

      // Filtra arquivos por tipo
      const plyFiles = modelPaths.filter(path => {
        const ext = path.split('.').pop()?.toLowerCase();
        return ext === 'ply';
      });

      const glbFiles = modelPaths.filter(path => {
        const ext = path.split('.').pop()?.toLowerCase();
        return ext === 'glb';
      });

      // Inicializa a cena se houver qualquer arquivo suportado
      if (plyFiles.length > 0 || glbFiles.length > 0) {
        console.log('📦 Carregando modelos:', { ply: plyFiles.length, glb: glbFiles.length });

        const THREE = await import('three');
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
        const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        // EffectComposer e RenderPass já importados de 'three-stdlib'
        // ShaderPass já importado de 'three-stdlib'
        const { VignetteShader } = await import('three/examples/jsm/shaders/VignetteShader.js');

        const scene = new THREE.Scene();
        // Background transparente quando AR está ativo, preto quando não está
        scene.background = null; // Sempre transparente para ver o vídeo
        sceneRef.current = scene; // Armazena referência da cena
        console.log('🎬 Nova cena criada | Objetos na cena:', scene.children.length);

        // 🖼️ Carrega textura de fundo se fornecida
        if (texturePath) {
          const fileExt = texturePath.toLowerCase().split('.').pop();
          
          if (fileExt === 'hdr') {
            // HDR: usa RGBELoader para equirectangular HDR
            const { RGBELoader } = await import('three/examples/jsm/loaders/RGBELoader.js');
            const rgbeLoader = new RGBELoader();
            rgbeLoader.load(
              texturePath,
              (texture) => {
                texture.mapping = THREE.EquirectangularReflectionMapping;
                bgTextureRef.current = texture;
                console.log('✅ Textura HDR carregada:', texturePath);
              },
              undefined,
              (error) => {
                console.error('❌ Erro ao carregar HDR:', error);
              }
            );
          } else if (fileExt === 'png' || fileExt === 'jpg' || fileExt === 'jpeg') {
            // PNG/JPG: usa TextureLoader padrão
            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(
              texturePath,
              (texture) => {
                texture.mapping = THREE.EquirectangularReflectionMapping;
                bgTextureRef.current = texture;
                console.log('✅ Textura carregada:', texturePath);
              },
              undefined,
              (error) => {
                console.error('❌ Erro ao carregar textura:', error);
              }
            );
          }
        }

        const camera = new THREE.PerspectiveCamera(
          75,
          containerRef.current.clientWidth / containerRef.current.clientHeight,
          0.1,
          1000
        );
        camera.position.set(0, 0, 8); // Posição frontal (x = 0 degrees rotation)
        camera.up.set(0, 1, 0); // Define Y como up (padrão)
        camera.lookAt(0, 0, 0); // Olha para o centro da cena
        activeCameraRef.current = camera; // Armazena câmera principal como ativa

        // 📱 Câmera 02 - AR Camera (câmera traseira do celular)
        // Valores realistas baseados em câmeras de smartphone
        const cameraAR = new THREE.PerspectiveCamera(
          53, // FOV realista cross-device (iPhone: 50-55°, Android: 55-60°)
          4 / 3, // Placeholder - será atualizado quando o video carregar
          0.01, // Near plane crítico para fake AR
          100   // Far plane - 1 unidade = 1 metro
        );
        cameraAR.position.set(0, 0, 0); // Câmera na origem
        cameraAR.rotation.order = 'YXZ'; // Ordem correta para DeviceOrientation
        cameraARRef.current = cameraAR;

        const renderer = new THREE.WebGLRenderer({ 
          antialias: true,
          alpha: true, // CRÍTICO: transparência para ver o vídeo
        });
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0x000000, 0); // CRÍTICO: alpha 0 = transparente
        renderer.outputColorSpace = THREE.SRGBColorSpace; // Cor correta
        renderer.toneMapping = THREE.ACESFilmicToneMapping; // Tone mapping para melhor iluminação
        renderer.toneMappingExposure = 1.0; // Exposição
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer; // 🌪️ Armazena referência ao renderer para partículas
        
        // Garante que o canvas fique sobre o vídeo mas com fundo transparente
        renderer.domElement.style.position = 'absolute';
        renderer.domElement.style.top = '0';
        renderer.domElement.style.left = '0';
        renderer.domElement.style.zIndex = '10'; // Acima do vídeo (z-index: 1)
        renderer.domElement.style.pointerEvents = 'auto'; // Permite interação com OrbitControls

        const ambientLight = new THREE.AmbientLight(0xffffff, ambientIntensity);
        ambientLightRef.current = ambientLight;
        scene.add(ambientLight);

        const pointLight = new THREE.PointLight(0xffffff, pointIntensity);
        pointLight.position.set(10, 10, 10);
        pointLightRef.current = pointLight;
        scene.add(pointLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, directionalIntensity);
        directionalLight.position.set(5, 5, 5);
        directionalLightRef.current = directionalLight;
        scene.add(directionalLight);

        console.log('💡 Luzes adicionadas (Ambient, Point, Directional) | Total objetos na cena:', scene.children.length);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.screenSpacePanning = false; // Mantém Z como up durante pan
        controls.maxPolarAngle = Math.PI; // Permite rotação completa

        // 🎨 Post-processing: Vignette (escurece os cantos)
        const composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, camera));
        
        // Bloom Pass (UnrealBloomPass)
        const bloomPass = new UnrealBloomPass(
          new THREE.Vector2(window.innerWidth, window.innerHeight),
          bloomIntensity,
          bloomThreshold,
          0.85
        );
        bloomPass.enabled = bloomEnabled && !useARCamera;
        bloomPassRef.current = bloomPass;
        composer.addPass(bloomPass);
        console.log('🌟 Bloom effect adicionado');
        
        const vignettePass = new ShaderPass(VignetteShader);
        vignettePass.uniforms['offset'].value = vignetteOffset;   // tamanho da vignette
        vignettePass.uniforms['darkness'].value = vignetteDarkness; // intensidade do escurecimento
        composer.addPass(vignettePass);
        vignettePassRef.current = vignettePass; // Armazena ref para controle via UI
        console.log('🎨 Vignette effect adicionado');

        const loader = new PLYLoader();
        const gltfLoader = new GLTFLoader();

        // Array para rastrear objetos (usando ref global)
        sceneObjectsRef.current = [];

        // 🔒 CARREGAMENTO SEQUENCIAL: Aguarda todos os modelos serem carregados antes de iniciar animação
        const loadingPromises: Promise<void>[] = [];
        
        // Carrega todos os arquivos GLB com Promises
        console.log('📋 Iniciando carregamento de GLBs. Total de arquivos:', glbFiles.length, glbFiles);
        
        glbFiles.forEach((glbFile, index) => {
          console.log(`🔄 Preparando carregamento GLB ${index}: ${glbFile}`);
          
          const glbPromise = new Promise<void>((resolve, reject) => {
            gltfLoader.load(
              glbFile,
              (gltf) => {
                const fileName = glbFile.split('/').pop() || `GLB ${index}`;
                
                // Verifica se já existe um objeto com esse nome na cena
                if (scene.getObjectByName(fileName)) {
                  console.warn('⚠️ DUPLICAÇÃO BLOQUEADA:', fileName, 'já existe na cena!');
                  resolve();
                  return;
                }
                
                const model = gltf.scene;
                model.position.set(0, 0, 0); // Nasce na origem
                model.name = fileName;
                
                // � Aplica shader PBR customizado aos GLBs
                model.traverse((child: THREE.Object3D) => {
                  const mesh = child as THREE.Mesh;
                  if (mesh.isMesh && mesh.material) {
                    // Aplica o shader PBR ao mesh
                    applyPBRShaderToGLB(mesh, fileName);
                  }
                });
                
                console.log('➕ Adicionando GLB à cena:', fileName, '| Total objetos na cena antes:', scene.children.length);
                scene.add(model);
                console.log('✅ GLB adicionado:', fileName, '| Total objetos na cena depois:', scene.children.length);
                
                sceneObjectsRef.current.push({
                  name: fileName,
                  object: model,
                  targetPosition: { x: 0, y: 0, z: 0 },
                  opacity: 1,
                  visible: true,
                  brightness: 1.0 // Brilho inicial
                });
                
                // Cleanup: modelo adicionado à cena, referências temporárias podem ser liberadas
                console.log(`🧹 GLB loader: recursos temporários liberados para ${fileName}`);
                resolve();
              },
              undefined,
              (error) => {
                console.error(`❌ Erro ao carregar GLB ${glbFile}:`, error);
                reject(error);
              }
            );
          });
          
          loadingPromises.push(glbPromise);
        });

        console.log('📋 Iniciando carregamento de PLYs. Total de arquivos:', plyFiles.length, plyFiles);
        
        // Carrega todos os PLYs com Promises para garantir ordem
        plyFiles.forEach((plyFile, index) => {
          console.log(`🔄 Preparando carregamento ${index}: ${plyFile}`);
          
          const plyPromise = new Promise<void>((resolve, reject) => {
            loader.load(
              plyFile,
              (geometry) => {
                geometry.computeVertexNormals();
                
                // 🔒 OBRIGATÓRIO: Normalização de cor para PLY/SPLAT (0-255 → 0-1)
                if (geometry.attributes.color) {
                  geometry.attributes.color.normalized = true;
                  console.log('✅ PLY: Color attribute normalized');
                }

                // 💎 ShaderMaterial de ALTA QUALIDADE para PLY/SPLAT
                const material = new THREE.ShaderMaterial({
                  transparent: true,
                  depthWrite: false,
                  depthTest: true,
                  vertexColors: true,
                  uniforms: {
                    uOpacity: { value: 1.0 },
                    uBrightness: { value: 1.0 }, // Brilho padrão = 1.0 (sem alteração)
                    uPointSize: { value: 2.0 } // Tamanho de ponto padrão = 2.0
                  },
                  vertexShader: plyVertexShader,
                  fragmentShader: plyFragmentShader
                });

                const points = new THREE.Points(geometry, material);
                const fileName = plyFile.split('/').pop() || `PLY ${index}`;
                
                // Verifica se já existe um objeto com esse nome na cena
                if (scene.getObjectByName(fileName)) {
                  console.warn('⚠️ DUPLICAÇÃO BLOQUEADA:', fileName, 'já existe na cena!');
                  resolve();
                  return;
                }
                
                points.name = fileName;
                
                geometry.computeBoundingBox();
                const boundingBox = geometry.boundingBox;
                if (boundingBox) {
                  const center = new THREE.Vector3();
                  boundingBox.getCenter(center);
                  
                  const size = new THREE.Vector3();
                  boundingBox.getSize(size);
                  const maxDim = Math.max(size.x, size.y, size.z);
                  const scale = 2 / maxDim;
                  
                  points.scale.setScalar(scale);
                  points.position.set(0, 0, 0); // Nasce na origem
                  points.rotation.set(Math.PI / 2, Math.PI, 0); // x = 90°, y = 180°
                }

                console.log('➕ Adicionando PLY à cena:', fileName, '| Total objetos na cena antes:', scene.children.length);
                scene.add(points);
                console.log('✅ PLY adicionado:', fileName, '| Total objetos na cena depois:', scene.children.length);
                sceneObjectsRef.current.push({ name: fileName, object: points, targetPosition: { x: 0, y: 0, z: 0 }, opacity: 1, visible: true });
                
                // Cleanup: geometria e material agora pertencem ao objeto Points na cena
                console.log(`🧹 PLY loader: recursos temporários liberados para ${fileName}`);
                resolve();
              },
              undefined,
              (error) => {
                console.error(`❌ Erro ao carregar PLY ${plyFile}:`, error);
                reject(error);
              }
            );
          });
          
          loadingPromises.push(plyPromise);
        });

        // 🎯 AGUARDA TODOS OS MODELOS SEREM CARREGADOS antes de iniciar a animação
        Promise.all(loadingPromises)
          .then(() => {
            console.log('✅ TODOS OS MODELOS CARREGADOS! Iniciando animação...');
            console.log('📊 Total de objetos carregados:', sceneObjectsRef.current.length);
            startAnimation();
          })
          .catch((error) => {
            console.error('❌ Erro ao carregar modelos:', error);
            // Mesmo com erro, tenta iniciar animação com o que foi carregado
            startAnimation();
          });

        let animationId: number;
        const startAnimation = () => {
          console.log('🎬 Iniciando loop de animação...');
          animate();
        };
        
        const animate = () => {
          animationId = requestAnimationFrame(animate);
          
          // 🎨 Atualiza uniforms dos materiais PBR dos GLBs (MeshStandardMaterial)
          shaderTimeRef.current += 0.016; // ~60fps
          glbPbrMaterialsRef.current.forEach((material) => {
            // Acessa o shader compilado armazenado no material
            const shader = (material as PBRMaterialWithShader).__shader;
            if (shader && shader.uniforms && shader.uniforms.uTime) {
              shader.uniforms.uTime.value = shaderTimeRef.current;
            }
          });
          
          //  Fake 4DOF: Aplica movimento baseado em device orientation + motion
          if (useARCamera && isInitialOrientationSet.current) {
            sceneObjectsRef.current.forEach(({ name, object, targetPosition, opacity, visible }) => {
              // Calcula diferença de orientação desde a posição inicial
              const deltaAlpha = (deviceOrientationRef.current.alpha - initialOrientationRef.current.alpha) * (Math.PI / 180);
              const deltaBeta = (deviceOrientationRef.current.beta - initialOrientationRef.current.beta) * (Math.PI / 180);
              const deltaGamma = (deviceOrientationRef.current.gamma - initialOrientationRef.current.gamma) * (Math.PI / 180);
              
              // Rotaciona objetos baseado na orientação do celular (invertido para parecer fixo no espaço)
              object.rotation.z = -deltaAlpha * 0.5; // yaw
              object.rotation.x = -deltaBeta * 0.5; // pitch
              object.rotation.y = -deltaGamma * 0.5; // roll
              
              // Posição baseada em acelerômetro (parallax suave)
              // Acelera movimento quanto mais o celular se inclina
              const sensitivity = 0.05; // Ajuste para controlar sensibilidade
              const posX = targetPosition.x + (deltaGamma * sensitivity);
              const posY = targetPosition.y + (deltaBeta * sensitivity);
              
              // Lerp suave para a nova posição
              const lerpFactor = 0.1;
              object.position.x += (posX - object.position.x) * lerpFactor;
              object.position.y += (posY - object.position.y) * lerpFactor;
              object.position.z += (targetPosition.z - object.position.z) * lerpFactor;
              
              // Aplica opacity e visibility com roteamento correto
              object.visible = visible;
              applyObjectOpacity(object, name, opacity);
            });
          } else {
            // Modo normal: apenas lerp para targetPosition
            sceneObjectsRef.current.forEach(({ name, object, targetPosition, opacity, visible }) => {
              const lerpFactor = 0.1;
              object.position.x += (targetPosition.x - object.position.x) * lerpFactor;
              object.position.y += (targetPosition.y - object.position.y) * lerpFactor;
              object.position.z += (targetPosition.z - object.position.z) * lerpFactor;
              
              // Aplica opacity e visibility com roteamento correto
              object.visible = visible;
              applyObjectOpacity(object, name, opacity);
            });
          }

          // Seleciona câmera ativa (removido: variável não utilizada)

          // Gerencia background/environment baseado no modo AR
          if (sceneRef.current && bgTextureRef.current) {
            if (useARCamera && bgTextureEnabled) {
              // Modo AR: environment ativo, background transparente
              if (sceneRef.current.background !== null) {
                sceneRef.current.background = null;
                console.log('📱 AR Mode: Background desativado (transparente), Environment mantido');
              }
              if (sceneRef.current.environment !== bgTextureRef.current) {
                sceneRef.current.environment = bgTextureRef.current;
              }
            } else if (!useARCamera && bgTextureEnabled) {
              // Modo normal: ambos ativos
              if (sceneRef.current.background !== bgTextureRef.current) {
                sceneRef.current.background = bgTextureRef.current;
              }
              if (sceneRef.current.environment !== bgTextureRef.current) {
                sceneRef.current.environment = bgTextureRef.current;
              }
            }
          }

          // Atualiza câmera AR com video aspect e device orientation
          if (useARCamera && isVideoReady && videoRef.current) {
            // ✅ REGRA DE OURO: aspect = video.videoWidth / video.videoHeight
            const videoAspect = videoRef.current.videoWidth / videoRef.current.videoHeight;
            if (cameraAR.aspect !== videoAspect) {
              cameraAR.aspect = videoAspect;
              cameraAR.updateProjectionMatrix();
              console.log('📐 Camera AR aspect atualizado:', videoAspect);
            }

            // Sincroniza com DeviceOrientation (fake 3DOF)
            const { alpha, beta, gamma } = deviceOrientationRef.current;
            // Converte device orientation para Euler angles
            cameraAR.rotation.y = THREE.MathUtils.degToRad(alpha); // yaw
            cameraAR.rotation.x = THREE.MathUtils.degToRad(beta - 90); // pitch (ajuste de 90° para landscape)
            cameraAR.rotation.z = THREE.MathUtils.degToRad(gamma); // roll
          }
          
          // 📷 Follow Camera: Rotaciona sistema de partículas para seguir câmera
          if (particleFollowCamera) {
            const activeCamera = useARCamera ? cameraAR : camera;
            particleSystemsRef.current.forEach((system) => {
              // Copia APENAS rotação da câmera para o sistema de partículas
              system.points.rotation.copy(activeCamera.rotation);
            });
          } else {
            // Reseta rotação quando followCamera está desativado
            particleSystemsRef.current.forEach((system) => {
              system.points.rotation.set(0, 0, 0);
            });
          }
          
          // Atualiza controles apenas para câmera principal
          if (!useARCamera) {
            controls.update();
          }
          
          // 🧹 Limpa buffers antes de renderizar para evitar cache visual
          renderer.clear(true, true, true);
          
          // Renderiza a cena com post-processing (vignette)
          composer.render();

          // 🔍 DEBUG: Renderiza edge texture se ativado
          if (debugEdgeTexture && particleSystemsRef.current.size > 0) {
            // Pega o primeiro sistema de partículas para debug
            const firstSystem = Array.from(particleSystemsRef.current.values())[0];
            if (firstSystem && firstSystem.edge) {
              // Renderiza edge texture em fullscreen para visualizar
              const debugScene = new THREE.Scene();
              const debugMaterial = new THREE.MeshBasicMaterial({
                map: firstSystem.edge.texture,
                side: THREE.DoubleSide,
              });
              const debugQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), debugMaterial);
              debugScene.add(debugQuad);
              
              const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
              renderer.setRenderTarget(null);
              renderer.clear(true, true, true);
              renderer.render(debugScene, orthoCamera);
              
              // Limpa temp objects
              debugMaterial.dispose();
              debugQuad.geometry.dispose();
            }
          }
          
          // Atualiza debug info constantemente
          const direction = new THREE.Vector3();
          camera.getWorldDirection(direction);
          const lookAtPoint = camera.position.clone().add(direction);
          
          // Atualiza informações de debug em tempo real
          const objectsInfo = sceneObjectsRef.current.map(({ name, object }) => ({
            name,
            position: {
              x: parseFloat(object.position.x.toFixed(2)),
              y: parseFloat(object.position.y.toFixed(2)),
              z: parseFloat(object.position.z.toFixed(2)),
            },
            rotation: {
              x: parseFloat((object.rotation.x * 180 / Math.PI).toFixed(1)),
              y: parseFloat((object.rotation.y * 180 / Math.PI).toFixed(1)),
              z: parseFloat((object.rotation.z * 180 / Math.PI).toFixed(1)),
            },
          }));

          // Calcula distância da câmera à origem
          const distanceToOrigin = parseFloat(camera.position.length().toFixed(2));
          
          // Calcula o tamanho do frustum no plano de distância atual
          const vFOV = camera.fov * Math.PI / 180; // converte para radianos
          const frustumHeight = 2 * Math.tan(vFOV / 2) * distanceToOrigin;
          const frustumWidth = frustumHeight * camera.aspect;
          
          // Calcula área visível aproximada
          const visibleArea = parseFloat((frustumWidth * frustumHeight).toFixed(2));

          // Cria sempre um objeto completamente novo para forçar re-render
          const newDebugInfo: DebugInfo = {
            camera: {
              x: parseFloat(camera.position.x.toFixed(2)),
              y: parseFloat(camera.position.y.toFixed(2)),
              z: parseFloat(camera.position.z.toFixed(2)),
            },
            cameraRotation: {
              x: parseFloat((camera.rotation.x * 180 / Math.PI).toFixed(1)),
              y: parseFloat((camera.rotation.y * 180 / Math.PI).toFixed(1)),
              z: parseFloat((camera.rotation.z * 180 / Math.PI).toFixed(1)),
            },
            lookAt: {
              x: parseFloat(lookAtPoint.x.toFixed(2)),
              y: parseFloat(lookAtPoint.y.toFixed(2)),
              z: parseFloat(lookAtPoint.z.toFixed(2)),
            },
            viewport: {
              width: renderer.domElement.width,
              height: renderer.domElement.height,
              aspect: parseFloat(camera.aspect.toFixed(3)),
              fov: camera.fov,
              near: camera.near,
              far: camera.far,
              frustumWidth: parseFloat(frustumWidth.toFixed(2)),
              frustumHeight: parseFloat(frustumHeight.toFixed(2)),
              distanceToOrigin,
              visibleArea,
            },
            objects: objectsInfo,
          };
          
          // Debug info atualizado em tempo real no overlay (console logs removidos para evitar duplicação)
          
          // Força atualização sempre criando objeto novo
          setDebugInfo({ ...newDebugInfo });
          setFrameCount(prev => prev + 1);
        };
        animate();

        const handleResize = () => {
          if (!containerRef.current) return;
          camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        };
        window.addEventListener('resize', handleResize);

        cleanupFunctionsRef.current.push(() => {
          console.log('🧹 Iniciando cleanup de recursos 3D...');
          
          // 1. Cancela animação primeiro
          if (animationId) {
            cancelAnimationFrame(animationId);
            console.log('  ✅ AnimationFrame cancelado');
          }
          
          // 2. Remove event listeners
          window.removeEventListener('resize', handleResize);
          
          // 3. Dispose controls
          controls.dispose();
          console.log('  ✅ Controls dispostos');
          
          // 4. Limpa objetos carregados e seus recursos ANTES de limpar a scene
          console.log('🧹 Limpando objetos 3D carregados...');
          sceneObjectsRef.current.forEach(({ name, object }) => {
            // Remove da scene primeiro
            if (scene && object.parent === scene) {
              scene.remove(object);
              console.log(`  🗑️ ${name} removido da scene`);
            }
            
            // Limpa geometria
            if ((object instanceof THREE.Mesh || object instanceof THREE.Points) && object.geometry) {
              object.geometry.dispose();
              console.log(`  ✅ Geometria de ${name} disposta`);
            }
            
            // Limpa material(is)
            if ((object instanceof THREE.Mesh || object instanceof THREE.Points) && object.material) {
              if (Array.isArray(object.material)) {
                object.material.forEach((mat: THREE.Material) => {
                  // Limpa texturas
                  if ('map' in mat && mat.map && mat.map instanceof THREE.Texture) {
                    mat.map.dispose();
                  }
                  mat.dispose();
                });
              } else {
                // Limpa texturas
                if (object.material.map) object.material.map.dispose();
                object.material.dispose();
              }
              console.log(`  ✅ Material de ${name} disposto`);
            }
            
            // Limpa children recursivamente (para GLB)
            if (object.children && object.children.length > 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              object.traverse((child: any) => {
                if (child.geometry) {
                  child.geometry.dispose();
                }
                if (child.material) {
                  if (Array.isArray(child.material)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    child.material.forEach((mat: any) => {
                      if (mat.map) mat.map.dispose();
                      mat.dispose();
                    });
                  } else {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                  }
                }
              });
            }
          });
          
          // 5. Limpa TODOS os objetos restantes da cena (cache)
          console.log('🧹 Limpando cache da scene...');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const objectsToRemove: any[] = [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          scene.traverse((object) => {
            if (object !== scene) {
              objectsToRemove.push(object);
              // Limpa recursos
              if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
                if (object.geometry) {
                  object.geometry.dispose();
                }
                if (object.material) {
                  if (Array.isArray(object.material)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    object.material.forEach((mat: any) => {
                      if (mat.map) mat.map.dispose();
                      mat.dispose();
                    });
                  } else {
                    if (object.material.map) object.material.map.dispose();
                    object.material.dispose();
                  }
                }
              }
            }
          });
          
          // Remove todos os objetos da scene
          objectsToRemove.forEach(obj => {
            if (obj.parent) {
              obj.parent.remove(obj);
            }
          });
          
          // 6. Clear final da scene
          scene.clear();
          console.log('  ✅ Scene completamente limpa');
          
          // 7. Limpa o frame buffer do renderer
          renderer.clear(true, true, true); // color, depth, stencil
          renderer.renderLists.dispose();
          console.log('  ✅ Frame buffer e render lists limpos');
          
          // 8. Remove canvas do DOM
          if (containerRef.current && containerRef.current.contains(renderer.domElement)) {
            containerRef.current.removeChild(renderer.domElement);
            console.log('  ✅ Canvas removido do DOM');
          }
          
          // 9. Dispose renderer
          renderer.dispose();
          console.log('🗑️ Renderer e todos os objetos descartados');
        });
      }
    };

    init();

    return () => {
      console.log('🧹 Iniciando cleanup...');
      cleanupFunctionsRef.current.forEach(fn => fn());
      cleanupFunctionsRef.current = []; // Limpa array de cleanup functions
      stopARCamera(); // Cleanup camera stream
      sceneObjectsRef.current = []; // Limpa referências de objetos
      sceneInitialized.current = false; // Reset flag para permitir nova inicialização
      console.log('✅ Cleanup completo: cena e objetos removidos, flag resetada');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelPaths, sceneEnabled]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full" 
      style={{ position: 'relative', background: 'transparent', overflow: 'hidden' }} 
    >
      {/* Video Background para AR Camera - DEVE ficar atrás do canvas */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full"
        style={{ 
          objectFit: 'cover',
          display: useARCamera && isVideoReady ? 'block' : 'none',
          zIndex: 1,
        }}
      />

      {/* Modal de Solicitação de Câmera */}
      {showCameraPrompt && !useARCamera && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-blue-600 to-purple-700 rounded-2xl p-6 max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="text-center">
              <div className="text-6xl mb-4">📱</div>
              <h2 className="text-2xl font-bold text-white mb-3">Experiência AR</h2>
              <p className="text-white/90 mb-4 text-sm">
                Permita o acesso à câmera para visualizar os modelos 3D em realidade aumentada no seu ambiente.
              </p>
              
              {/* Aviso de protocolo */}
              {window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && (
                <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 mb-4">
                  <p className="text-red-200 text-xs font-bold mb-1">🔒 HTTPS Obrigatório</p>
                  <p className="text-red-200/80 text-xs">
                    A câmera só funciona em sites HTTPS. Você está acessando via {window.location.protocol}
                  </p>
                </div>
              )}
              
              <div className="bg-yellow-500/20 border border-yellow-500/50 rounded-lg p-3 mb-4">
                <p className="text-yellow-200 text-xs">
                  ⚠️ Ao clicar, seu navegador pedirá permissão para acessar a câmera. Clique em &quot;Permitir&quot;.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <button
                  onClick={async () => {
                    setShowCameraPrompt(false);
                    await startARCamera();
                  }}
                  className="bg-white text-blue-600 px-6 py-3 rounded-xl font-bold text-lg hover:bg-blue-50 transition-colors shadow-lg"
                >
                  ✅ Ativar Câmera AR
                </button>
                <button
                  onClick={() => setShowCameraPrompt(false)}
                  className="bg-white/10 text-white px-6 py-2 rounded-xl font-semibold text-sm hover:bg-white/20 transition-colors"
                >
                  Usar Câmera Principal
                </button>
              </div>
              <p className="text-white/60 text-xs mt-4">
                💡 Funciona melhor em dispositivos móveis com giroscópio
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Botão para alternar câmera */}
      <div className="absolute top-2 left-2 z-50 flex gap-2 flex-wrap">
        {/* Checkbox para iniciar a cena - fica marcado e desabilitado após primeira ativação */}
        <label className={`${sceneEnabled ? 'bg-green-500' : 'bg-gray-500 hover:bg-green-600 cursor-pointer'} text-white px-4 py-2 rounded-lg font-semibold text-sm shadow-lg transition-colors flex items-center gap-2`}>
          <input
            type="checkbox"
            checked={sceneEnabled}
            disabled={sceneEnabled} // Desabilita após ser marcado
            onChange={(e) => {
              const enabled = e.target.checked;
              console.log(`🔄 Cena ${enabled ? 'habilitada' : 'desabilitada'}`);
              setSceneEnabled(enabled);
            }}
            className="w-4 h-4"
          />
          <span>{sceneEnabled ? '✅ Cena Ativa' : '▶️ Iniciar Cena'}</span>
        </label>
        
        <button
          onClick={() => {
            if (useARCamera) {
              stopARCamera();
            } else {
              startARCamera();
            }
          }}
          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold text-sm shadow-lg transition-colors"
        >
          {useARCamera ? '📷 Câmera Principal' : '📱 Câmera AR'}
        </button>
        
        {/* Botão para toggle debug overlay */}
        <button
          onClick={() => setShowDebugOverlay(!showDebugOverlay)}
          className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg font-semibold text-sm shadow-lg transition-colors"
          title={showDebugOverlay ? 'Esconder Debug' : 'Mostrar Debug'}
        >
          {showDebugOverlay ? '🔽 Esconder Logs' : '🔼 Mostrar Logs'}
        </button>
        
        {useARCamera && !isVideoReady && (
          <div className="bg-yellow-500 text-black px-3 py-2 rounded-lg text-xs font-semibold">
            ⏳ Iniciando câmera...
          </div>
        )}
        {useARCamera && isVideoReady && (
          <div className="bg-green-500 text-white px-3 py-2 rounded-lg text-xs font-semibold">
            ✅ AR Ativa
          </div>
        )}
      </div>
      
      {/* Debug Info Overlay - Condicional */}
      {showDebugOverlay && (
        <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm text-white p-3 rounded-lg text-xs font-mono z-50 max-w-xs max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-sm text-green-400">📊 Debug Info</h3>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
              <span className="text-[9px] text-gray-400">Frame: {frameCount}</span>
            </div>
          </div>
        
        {/* Camera Info */}
        <div className="mb-3 border-b border-white/20 pb-2">
          <p className="font-semibold text-yellow-300 mb-1">
            📷 Câmera: {useARCamera ? '📱 AR Mode' : '🖥️ Principal'}
          </p>
          <p className="text-[10px]">Posição:</p>
          <p className="ml-2">X: {debugInfo.camera.x}</p>
          <p className="ml-2">Y: {debugInfo.camera.y}</p>
          <p className="ml-2">Z: {debugInfo.camera.z}</p>
          <p className="text-[10px] mt-1">Rotação (graus):</p>
          <p className="ml-2">X: {debugInfo.cameraRotation.x}°</p>
          <p className="ml-2">Y: {debugInfo.cameraRotation.y}°</p>
          <p className="ml-2">Z: {debugInfo.cameraRotation.z}°</p>
          {useARCamera && isVideoReady && videoRef.current && (
            <>
              <p className="text-[10px] mt-1 text-cyan-300">📱 Video Stream:</p>
              <p className="ml-2 text-[9px]">Res: {videoRef.current.videoWidth}×{videoRef.current.videoHeight}</p>
              <p className="ml-2 text-[9px]">Aspect: {(videoRef.current.videoWidth / videoRef.current.videoHeight).toFixed(3)}</p>
              <p className="text-[10px] mt-1 text-pink-300">🧭 Device Orientation:</p>
              <p className="ml-2 text-[9px]">α (yaw): {deviceOrientationRef.current.alpha.toFixed(1)}°</p>
              <p className="ml-2 text-[9px]">β (pitch): {deviceOrientationRef.current.beta.toFixed(1)}°</p>
              <p className="ml-2 text-[9px]">γ (roll): {deviceOrientationRef.current.gamma.toFixed(1)}°</p>
            </>
          )}
          <p className="text-[10px] mt-1">Look At (direção):</p>
          <p className="ml-2">X: {debugInfo.lookAt.x}</p>
          <p className="ml-2">Y: {debugInfo.lookAt.y}</p>
          <p className="ml-2">Z: {debugInfo.lookAt.z}</p>
          
          {/* Botão para salvar câmera */}
          <button
            onClick={saveCamera}
            disabled={savedCameras.length >= 4}
            className={`mt-2 w-full py-1 px-2 rounded text-[9px] font-semibold ${
              savedCameras.length >= 4 
                ? 'bg-gray-500 cursor-not-allowed' 
                : 'bg-green-500 hover:bg-green-600'
            }`}
          >
            💾 Salvar Câmera ({savedCameras.length}/4)
          </button>
        </div>

        {/* Vignette Controls */}
        <div className="mb-3 border-b border-white/20 pb-2">
          <p className="font-semibold text-pink-300 mb-2">🎨 Vignette Effect:</p>
          
          <div className="mb-2">
            <label className="text-[10px] text-gray-300 mb-1 block">
              Offset (Tamanho): {vignetteOffset.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="3"
              step="0.1"
              value={vignetteOffset}
              onChange={(e) => setVignetteOffset(parseFloat(e.target.value))}
              className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
            />
          </div>
          
          <div>
            <label className="text-[10px] text-gray-300 mb-1 block">
              Darkness (Intensidade): {vignetteDarkness.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="3"
              step="0.1"
              value={vignetteDarkness}
              onChange={(e) => setVignetteDarkness(parseFloat(e.target.value))}
              className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>

        {/* Bloom Controls */}
        <div className="mb-3 border-b border-white/20 pb-2">
          <p className="font-semibold text-yellow-400 mb-2">🌟 Bloom Effect:</p>
          
          {useARCamera && (
            <p className="text-[9px] text-orange-300 mb-2 bg-orange-500/20 p-1 rounded">
              ⚠️ Desativado na câmera AR
            </p>
          )}
          
          <div className="mb-2">
            <div className="flex items-center gap-2 mb-2">
              <input 
                type="checkbox"
                checked={bloomEnabled && !useARCamera}
                onChange={(e) => setBloomEnabled(e.target.checked)}
                disabled={useARCamera}
                className="w-3 h-3"
                id="bloom-toggle"
              />
              <label htmlFor="bloom-toggle" className="text-[10px] text-gray-300">
                Ativar Bloom {useARCamera ? '(desabilitado em AR)' : ''}
              </label>
            </div>
          </div>
          
          {bloomEnabled && !useARCamera && (
            <>
              <div className="mb-2">
                <label className="text-[10px] text-gray-300 mb-1 block">
                  Intensidade: {bloomIntensity.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="5"
                  step="0.1"
                  value={bloomIntensity}
                  onChange={(e) => setBloomIntensity(parseFloat(e.target.value))}
                  className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                />
              </div>
              
              <div>
                <label className="text-[10px] text-gray-300 mb-1 block">
                  Threshold: {bloomThreshold.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={bloomThreshold}
                  onChange={(e) => setBloomThreshold(parseFloat(e.target.value))}
                  className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </>
          )}
        </div>

        {/* Background Texture Control */}
        {texturePath && (
          <div className="mb-3 border-b border-white/20 pb-2">
            <p className="font-semibold text-purple-300 mb-2">🖼️ Background Texture:</p>
            <p className="text-[10px] text-gray-400 mb-2">
              {texturePath.split('/').pop()}
            </p>
            <button
              onClick={() => toggleBackgroundTexture(!bgTextureEnabled)}
              disabled={!bgTextureRef.current}
              className={`w-full py-1 px-2 rounded text-[9px] font-semibold ${
                !bgTextureRef.current
                  ? 'bg-gray-500 cursor-not-allowed'
                  : bgTextureEnabled
                  ? 'bg-orange-500 hover:bg-orange-600'
                  : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              {!bgTextureRef.current ? '⏳ Carregando...' : bgTextureEnabled ? '🔲 Desativar Background' : '🖼️ Ativar Background'}
            </button>
            {bgTextureEnabled && (
              <p className="text-[9px] text-green-400 mt-1">✓ Background visível (Environment sempre ativo)</p>
            )}
          </div>
        )}

        {/* Luzes da Cena */}
        <div className="mb-3 border-b border-white/20 pb-2">
          <p className="font-semibold text-yellow-300 mb-2">💡 Luzes da Cena:</p>
          <div className="bg-white/5 rounded p-2 border border-white/10 mb-3">
            <p className="text-[9px] text-gray-300 font-mono mb-1">📊 Luzes ativas:</p>
            <div className="space-y-1 text-[9px] text-gray-200 font-mono">
              <div className="flex justify-between">
                <span>🟡 AmbientLight</span>
                <span className="text-yellow-300">{ambientIntensity.toFixed(3)}</span>
              </div>
              <div className="flex justify-between">
                <span>🟠 PointLight</span>
                <span className="text-orange-300">{pointIntensity.toFixed(3)}</span>
              </div>
              <div className="flex justify-between">
                <span>⚪ DirectionalLight</span>
                <span className="text-blue-300">{directionalIntensity.toFixed(3)}</span>
              </div>
            </div>
          </div>

          {/* Sliders de controle */}
          <div className="space-y-2">
            <div>
              <label className="text-[9px] text-gray-300 mb-1 block">🟡 AmbientLight</label>
              <input
                type="range"
                min="0"
                max="5"
                step="0.01"
                value={ambientIntensity}
                onChange={e => setAmbientIntensity(parseFloat(e.target.value))}
                className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
              />
            </div>
            <div>
              <label className="text-[9px] text-gray-300 mb-1 block">🟠 PointLight</label>
              <input
                type="range"
                min="0"
                max="5"
                step="0.01"
                value={pointIntensity}
                onChange={e => setPointIntensity(parseFloat(e.target.value))}
                className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
              />
            </div>
            <div>
              <label className="text-[9px] text-gray-300 mb-1 block">⚪ DirectionalLight</label>
              <input
                type="range"
                min="0"
                max="5"
                step="0.01"
                value={directionalIntensity}
                onChange={e => setDirectionalIntensity(parseFloat(e.target.value))}
                className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* 🌐 Shader HDRI Equirectangular */}
        {equirectGLBs.size > 0 && (
          <div className="mb-3 border-b border-white/20 pb-2">
            <p className="font-semibold text-green-400 mb-2">🌐 HDRI Equirectangular:</p>
            <div className="space-y-2">
              {/* Checkbox para habilitar/desabilitar metal */}
              <div className="flex items-center gap-2 mb-2 p-2 bg-gray-700 rounded">
                <input
                  type="checkbox"
                  id="useMetal"
                  checked={equirectUseMetal}
                  onChange={e => setEquirectUseMetal(e.target.checked)}
                  className="w-4 h-4 cursor-pointer"
                />
                <label htmlFor="useMetal" className="text-[9px] text-gray-300 cursor-pointer flex-1">
                  {equirectUseMetal ? '✅ Modo Metal (PBR)' : '📊 Modo Reflexão Simples'}
                </label>
              </div>

              {/* Renderiza controles diferentes baseado no modo */}
              {equirectUseMetal ? (
                <>
                  {/* Presets */}
                  <div>
                    <p className="text-[9px] text-gray-400 mb-1">🎨 Presets Metalness:</p>
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        onClick={() => applyMetalPreset('gold')}
                        className="py-1 px-2 bg-yellow-600 hover:bg-yellow-700 rounded text-[8px] font-semibold"
                      >
                        🟡 Ouro
                      </button>
                      <button
                        onClick={() => applyMetalPreset('copper')}
                        className="py-1 px-2 bg-orange-600 hover:bg-orange-700 rounded text-[8px] font-semibold"
                      >
                        🟠 Cobre
                      </button>
                      <button
                        onClick={() => applyMetalPreset('scifiBlue')}
                        className="py-1 px-2 bg-blue-600 hover:bg-blue-700 rounded text-[8px] font-semibold"
                      >
                        🔵 Aço Azulado
                      </button>
                      <button
                        onClick={() => applyMetalPreset('aluminum')}
                        className="py-1 px-2 bg-gray-500 hover:bg-gray-600 rounded text-[8px] font-semibold"
                      >
                        ⚪ Alumínio
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[9px] text-gray-300 mb-1 block">
                      Brilho: {equirectBrightness.toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.05"
                      value={equirectBrightness}
                      onChange={e => setEquirectBrightness(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="text-[9px] text-gray-300 mb-1 block">
                      Metalness: {equirectMetalness.toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={equirectMetalness}
                      onChange={e => setEquirectMetalness(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="text-[9px] text-gray-300 mb-1 block">
                      Metal Color (Hex):
                    </label>
                    <div className="flex gap-1">
                      <input
                        type="color"
                        value={'#' + equirectMetalColor.getHexString()}
                        onChange={e => {
                          const color = new THREE.Color(e.target.value);
                          color.convertSRGBToLinear();
                          setEquirectMetalColor(color);
                        }}
                        className="flex-1 h-6 rounded cursor-pointer"
                      />
                      <span className="text-[9px] text-gray-400 self-center">
                        RGB({equirectMetalColor.r.toFixed(2)}, {equirectMetalColor.g.toFixed(2)}, {equirectMetalColor.b.toFixed(2)})
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="text-[9px] text-gray-300 mb-1 block">
                      Fresnel Power: {equirectFresnelPower.toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="10"
                      step="0.1"
                      value={equirectFresnelPower}
                      onChange={e => setEquirectFresnelPower(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </>
              ) : (
                <>
                  {/* Controles para modo reflexão simples */}
                  <div>
                    <label className="text-[9px] text-gray-300 mb-1 block">
                      Reflection Strength: {equirectReflectionStrength.toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.05"
                      value={equirectReflectionStrength}
                      onChange={e => setEquirectReflectionStrength(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="text-[9px] text-gray-300 mb-1 block">
                      Fresnel Power: {equirectFresnelPower.toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="10"
                      step="0.1"
                      value={equirectFresnelPower}
                      onChange={e => setEquirectFresnelPower(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* 🌪️ Particle System Controls */}
        {equirectGLBs.size > 0 && (
          <div className="mb-3 border-b border-white/20 pb-2">
            <p className="font-semibold text-purple-400 mb-2">🌪️ PARTÍCULAS (GPU Curl Noise):</p>
            <div className="space-y-2">
              {/* Checkbox para habilitar/desabilitar partículas */}
              <div className="flex items-center gap-2 mb-2 p-2 bg-gray-700 rounded">
                <input
                  type="checkbox"
                  id="enableParticles"
                  checked={particlesEnabled}
                  onChange={e => setParticlesEnabled(e.target.checked)}
                  className="w-4 h-4 cursor-pointer"
                />
                <label htmlFor="enableParticles" className="text-[9px] text-gray-300 cursor-pointer flex-1">
                  {particlesEnabled ? '✅ Partículas Ativas' : '❌ Partículas Desativadas'}
                </label>
              </div>

              {particlesEnabled && (
                <>
                  {/* Densidade de partículas */}
                  <div>
                    <label className="text-[9px] text-gray-300 mb-1 block">
                      💫 Densidade: {particleDensity.toFixed(2)}x ({Math.floor(2048 * particleDensity)} partículas)
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={particleDensity}
                      onChange={e => setParticleDensity(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Velocidade das partículas */}
                  <div>
                    <label className="text-[9px] text-gray-300 mb-1 block">
                      ⚡ Velocidade: {particleSpeed.toFixed(2)}x
                    </label>
                    <input
                      type="range"
                      min="0.3"
                      max="1.5"
                      step="0.05"
                      value={particleSpeed}
                      onChange={e => setParticleSpeed(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Força do vórtice */}
                  <div>
                    <label className="text-[9px] text-gray-300 mb-1 block">
                      🌀 Força Vórtice: {particleVortexStrength.toFixed(2)}x
                    </label>
                    <input
                      type="range"
                      min="0.3"
                      max="2.0"
                      step="0.1"
                      value={particleVortexStrength}
                      onChange={e => setParticleVortexStrength(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Força do curl noise */}
                  <div>
                    <label className="text-[9px] text-gray-300 mb-1 block">
                      🌪️ Força Curl: {particleCurlStrength.toFixed(2)}x
                    </label>
                    <input
                      type="range"
                      min="0.3"
                      max="2.0"
                      step="0.1"
                      value={particleCurlStrength}
                      onChange={e => setParticleCurlStrength(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Tamanho das partículas */}
                  <div>
                    <label className="text-[9px] text-gray-300 mb-1 block">
                      📏 Tamanho: {particleSize.toFixed(2)}x
                    </label>
                    <input
                      type="range"
                      min="0.3"
                      max="2.0"
                      step="0.1"
                      value={particleSize}
                      onChange={e => setParticleSize(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Força do Burst (emissão inicial) */}
                  <div>
                    <label className="text-[9px] text-gray-300 mb-1 block">
                      💥 Força Burst: {particleBurstStrength.toFixed(2)}x
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="5.0"
                      step="0.1"
                      value={particleBurstStrength}
                      onChange={e => setParticleBurstStrength(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Tempo de estabilização */}
                  <div>
                    <label className="text-[9px] text-gray-300 mb-1 block">
                      ⏱️ Tempo Settle: {particleSettleTime.toFixed(2)}s
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="3.0"
                      step="0.1"
                      value={particleSettleTime}
                      onChange={e => setParticleSettleTime(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Follow Camera Toggle */}
                  <label className="flex items-center justify-between text-[8px] text-gray-300 cursor-pointer hover:text-white transition">
                    <span>📷 Follow Camera</span>
                    <input
                      type="checkbox"
                      checked={particleFollowCamera}
                      onChange={e => setParticleFollowCamera(e.target.checked)}
                      className="w-4 h-4"
                    />
                  </label>

                  {/* Attractor Strength (0 = vortex puro, 2 = orbital forte) */}
                  <div className="space-y-0.5">
                    <label className="text-[8px] text-gray-300 flex items-center justify-between">
                      <span>🧲 Orbital Attractor</span>
                      <span className="font-mono text-cyan-400">{particleAttractorStrength.toFixed(2)}</span>
                    </label>
                    <input
                      type="range"
                      min="0.0"
                      max="2.0"
                      step="0.1"
                      value={particleAttractorStrength}
                      onChange={e => setParticleAttractorStrength(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Orbit Distance */}
                  <div className="space-y-0.5">
                    <label className="text-[8px] text-gray-300 flex items-center justify-between">
                      <span>🌀 Orbit Radius</span>
                      <span className="font-mono text-cyan-400">{particleOrbitDistance.toFixed(2)}</span>
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={particleOrbitDistance}
                      onChange={e => setParticleOrbitDistance(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Orbit Speed */}
                  <div className="space-y-0.5">
                    <label className="text-[8px] text-gray-300 flex items-center justify-between">
                      <span>🔄 Orbit Speed</span>
                      <span className="font-mono text-cyan-400">{particleOrbitSpeed.toFixed(2)}</span>
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="3.0"
                      step="0.1"
                      value={particleOrbitSpeed}
                      onChange={e => setParticleOrbitSpeed(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Info */}
                  <div className="text-[7px] text-gray-500 p-1 bg-gray-800 rounded">
                    ✨ GPU-accelerated | Orbital + Vortex | Camera Follow | Smooth Float
                  </div>

                  {/* Debug: Visualize Edge Texture */}
                  <button
                    onClick={() => setDebugEdgeTexture(!debugEdgeTexture)}
                    className={`w-full text-[8px] py-1 rounded font-semibold transition ${
                      debugEdgeTexture
                        ? 'bg-cyan-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {debugEdgeTexture ? '🔍 Debug: Mostrando Edge Texture' : '👁️ Debug: Ver Edge Texture'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Saved Cameras */}
        {savedCameras.length > 0 && (
          <div className="mb-3 border-b border-white/20 pb-2">
            <p className="font-semibold text-green-300 mb-2">📷 Câmeras Salvas:</p>
            
            {/* Botões de controle de animação */}
            {savedCameras.length >= 2 && (
              <div className="mb-2 flex gap-1">
                <button
                  onClick={createCameraAnimation}
                  disabled={isAnimating}
                  className={`flex-1 py-1 px-2 rounded text-[9px] font-semibold ${
                    isAnimating 
                      ? 'bg-gray-500 cursor-not-allowed' 
                      : 'bg-orange-500 hover:bg-orange-600'
                  }`}
                >
                  🎬 Criar Animação
                </button>
                {isAnimating ? (
                  <button
                    onClick={stopCameraAnimation}
                    className="flex-1 py-1 px-2 bg-red-500 hover:bg-red-600 rounded text-[9px] font-semibold"
                  >
                    ⏹️ Parar
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      if (savedCameras.length >= 2) {
                        createCameraAnimation();
                      }
                    }}
                    disabled={savedCameras.length < 2}
                    className={`flex-1 py-1 px-2 rounded text-[9px] font-semibold ${
                      savedCameras.length < 2
                        ? 'bg-gray-500 cursor-not-allowed'
                        : 'bg-green-500 hover:bg-green-600'
                    }`}
                  >
                    ▶️ Play
                  </button>
                )}
              </div>
            )}
            
            {/* Progress bar durante animação */}
            {isAnimating && (
              <div className="mb-2 bg-white/10 rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-green-500 h-full transition-all duration-100"
                  style={{ width: `${animationProgressRef.current * 100}%` }}
                ></div>
              </div>
            )}
            
            {savedCameras.map((cam) => (
              <div key={cam.id} className="mb-2 p-2 bg-white/5 rounded border border-green-500/30">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] font-semibold text-green-300">{cam.name}</p>
                  <button
                    onClick={() => deleteSavedCamera(cam.id)}
                    className="text-[9px] text-red-400 hover:text-red-300"
                  >
                    🗑️
                  </button>
                </div>
                <p className="text-[9px] text-gray-400">Pos: ({cam.position.x}, {cam.position.y}, {cam.position.z})</p>
                <p className="text-[9px] text-gray-400">Rot: ({cam.rotation.x}°, {cam.rotation.y}°, {cam.rotation.z}°)</p>
                <button
                  onClick={() => applySavedCamera(cam)}
                  className="mt-1 w-full py-1 px-2 bg-blue-500 hover:bg-blue-600 rounded text-[9px] font-semibold"
                >
                  ▶️ Aplicar
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Viewport Info */}
        <div className="mb-3 border-b border-white/20 pb-2">
          <p className="font-semibold text-purple-300 mb-1">🖥️ Viewport:</p>
          <p className="text-[10px]">Dimensões Canvas:</p>
          <p className="ml-2">{debugInfo.viewport.width} × {debugInfo.viewport.height}px</p>
          <p className="text-[10px] mt-1">Propriedades Câmera:</p>
          <p className="ml-2">FOV: {debugInfo.viewport.fov}°</p>
          <p className="ml-2">Aspect: {debugInfo.viewport.aspect}</p>
          <p className="ml-2">Near: {debugInfo.viewport.near}</p>
          <p className="ml-2">Far: {debugInfo.viewport.far}</p>
          <p className="text-[10px] mt-1 text-cyan-300">📐 Cálculos Matemáticos:</p>
          <p className="ml-2 text-[9px]">Dist. Origem: {debugInfo.viewport.distanceToOrigin}</p>
          <p className="ml-2 text-[9px]">Frustum W: {debugInfo.viewport.frustumWidth}</p>
          <p className="ml-2 text-[9px]">Frustum H: {debugInfo.viewport.frustumHeight}</p>
          <p className="ml-2 text-[9px]">Área Visível: {debugInfo.viewport.visibleArea}</p>
        </div>

        {/* Objects Info - Separado por tipo */}
        <div>
          <p className="font-semibold text-blue-300 mb-2">🎯 Objetos na Cena:</p>
          {debugInfo.objects.length === 0 ? (
            <p className="text-gray-400 text-[10px]">Carregando...</p>
          ) : (
            <>
              {/* GLB Models */}
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {debugInfo.objects.filter((obj: any) => obj.name.toLowerCase().endsWith('.glb')).length > 0 && (
                <div className="mb-3">
                  <p className="font-semibold text-green-300 mb-1 text-[10px]">📦 GLB Models:</p>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {debugInfo.objects.filter((obj: any) => obj.name.toLowerCase().endsWith('.glb')).map((obj, idx) => (
                    <div key={`${obj.name}-${idx}`} className="mb-3 pl-2 border-l-2 border-green-500/50">
                      <div className="flex items-center gap-2 mb-2">
                        <p className="text-[10px] font-semibold text-green-200 flex-1">{obj.name}</p>
                      </div>
                      
                      {/* Controles de Visibilidade e Opacity */}
                      <div className="mt-2 mb-2 space-y-1">
                        <div className="flex items-center gap-2">
                          <input 
                            type="checkbox"
                            defaultChecked={true}
                            onChange={(e) => toggleObjectVisibility(obj.name, e.target.checked)}
                            className="w-3 h-3"
                            id={`visible-${obj.name}`}
                          />
                          <label htmlFor={`visible-${obj.name}`} className="text-[9px] text-cyan-300">
                            👁️ Visível
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-purple-300 w-16">🎨 Opacity:</span>
                          <input 
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            defaultValue="1"
                            onChange={(e) => {
                              const value = parseFloat(e.target.value);
                              updateObjectOpacity(obj.name, value);
                              const display = e.target.nextElementSibling;
                              if (display) display.textContent = `${Math.round(value * 100)}%`;
                            }}
                            className="flex-1 h-1"
                          />
                          <span className="text-[9px] text-white/60 w-8">100%</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-yellow-300 w-16">💡 Brilho:</span>
                          <input 
                            type="range"
                            min="0"
                            max="3"
                            step="0.1"
                            defaultValue="1"
                            onChange={(e) => {
                              const value = parseFloat(e.target.value);
                              updateGLBBrightness(obj.name, value);
                              const display = e.target.nextElementSibling;
                              if (display) display.textContent = value.toFixed(1);
                            }}
                            className="flex-1 h-1"
                          />
                          <span className="text-[9px] text-white/60 w-8">1.0</span>
                        </div>
                        
                        <div className="flex items-center gap-2 mt-2">
                          <input 
                            type="checkbox"
                            id={`equirect-${obj.name}`}
                            checked={equirectGLBs.has(obj.name)}
                            onChange={(e) => {
                              toggleEquirectangularShader(obj.name, e.target.checked);
                            }}
                            className="w-4 h-4 cursor-pointer"
                          />
                          <label htmlFor={`equirect-${obj.name}`} className="text-[9px] text-green-300">
                            🌐 HDRI Equirectangular
                          </label>
                        </div>
                      </div>
                      
                      <p className="text-[9px] text-gray-300 mt-1">Posição:</p>
                      <div className="ml-2 flex items-center gap-1">
                        <span className="text-[9px] w-6">X:</span>
                        <input 
                          key={`${obj.name}-x-${obj.position.x}`}
                          type="number" 
                          step="0.1"
                          defaultValue={obj.position.x}
                          onChange={(e) => updateObjectPosition(obj.name, 'x', parseFloat(e.target.value) || 0)}
                          className="w-14 bg-white/10 border border-white/20 rounded px-1 text-[9px] text-white"
                        />
                      </div>
                      <div className="ml-2 flex items-center gap-1">
                        <span className="text-[9px] w-6">Y:</span>
                        <input 
                          key={`${obj.name}-y-${obj.position.y}`}
                          type="number" 
                          step="0.1"
                          defaultValue={obj.position.y}
                          onChange={(e) => updateObjectPosition(obj.name, 'y', parseFloat(e.target.value) || 0)}
                          className="w-14 bg-white/10 border border-white/20 rounded px-1 text-[9px] text-white"
                        />
                      </div>
                      <div className="ml-2 flex items-center gap-1">
                        <span className="text-[9px] w-6">Z:</span>
                        <input 
                          key={`${obj.name}-z-${obj.position.z}`}
                          type="number" 
                          step="0.1"
                          defaultValue={obj.position.z}
                          onChange={(e) => updateObjectPosition(obj.name, 'z', parseFloat(e.target.value) || 0)}
                          className="w-14 bg-white/10 border border-white/20 rounded px-1 text-[9px] text-white"
                        />
                      </div>
                      <p className="text-[9px] text-gray-300 mt-1">Rotação (graus):</p>
                      <div className="ml-2 flex items-center gap-1">
                        <span className="text-[9px] w-6">X:</span>
                        <input 
                          type="number" 
                          step="1"
                          defaultValue={obj.rotation.x}
                          onChange={(e) => updateObjectRotation(obj.name, 'x', parseFloat(e.target.value) || 0)}
                          className="w-14 bg-white/10 border border-white/20 rounded px-1 text-[9px] text-white"
                        />
                        <span className="text-[9px] text-white/60">°</span>
                      </div>
                      <div className="ml-2 flex items-center gap-1">
                        <span className="text-[9px] w-6">Y:</span>
                        <input 
                          type="number" 
                          step="1"
                          defaultValue={obj.rotation.y}
                          onChange={(e) => updateObjectRotation(obj.name, 'y', parseFloat(e.target.value) || 0)}
                          className="w-14 bg-white/10 border border-white/20 rounded px-1 text-[9px] text-white"
                        />
                        <span className="text-[9px] text-white/60">°</span>
                      </div>
                      <div className="ml-2 flex items-center gap-1">
                        <span className="text-[9px] w-6">Z:</span>
                        <input 
                          type="number" 
                          step="1"
                          defaultValue={obj.rotation.z}
                          onChange={(e) => updateObjectRotation(obj.name, 'z', parseFloat(e.target.value) || 0)}
                          className="w-14 bg-white/10 border border-white/20 rounded px-1 text-[9px] text-white"
                        />
                        <span className="text-[9px] text-white/60">°</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {/* PLY Models */}
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {debugInfo.objects.filter((obj: any) => obj.name.toLowerCase().endsWith('.ply')).length > 0 && (
                <div className="mb-3">
                  <p className="font-semibold text-yellow-300 mb-1 text-[10px]">☁️ PLY Models:</p>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {debugInfo.objects.filter((obj: any) => obj.name.toLowerCase().endsWith('.ply')).map((obj, idx) => (
              <div key={`${obj.name}-${idx}`} className="mb-3 pl-2 border-l-2 border-blue-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-[10px] font-semibold text-white/90 flex-1">{obj.name}</p>
                </div>
                
                {/* Controles de Visibilidade e Opacity */}
                <div className="mt-2 mb-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox"
                      defaultChecked={true}
                      onChange={(e) => toggleObjectVisibility(obj.name, e.target.checked)}
                      className="w-3 h-3"
                      id={`visible-${obj.name}`}
                    />
                    <label htmlFor={`visible-${obj.name}`} className="text-[9px] text-cyan-300">
                      👁️ Visível
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-purple-300 w-16">🎨 Opacity:</span>
                    <input 
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      defaultValue="1"
                      onChange={(e) => {
                        const value = parseFloat(e.target.value);
                        updateObjectOpacity(obj.name, value);
                        // Atualiza o display do valor
                        const display = e.target.nextElementSibling;
                        if (display) display.textContent = `${Math.round(value * 100)}%`;
                      }}
                      className="flex-1 h-1"
                    />
                    <span className="text-[9px] text-white/60 w-8">100%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-yellow-300 w-16">💡 Brilho:</span>
                    <input 
                      type="range"
                      min="0"
                      max="10"
                      step="0.1"
                      defaultValue="1"
                      onChange={(e) => {
                        const value = parseFloat(e.target.value);
                        updateObjectBrightness(obj.name, value);
                        const display = e.target.nextElementSibling;
                        if (display) display.textContent = `${value.toFixed(1)}x`;
                      }}
                      className="flex-1 h-1"
                    />
                    <span className="text-[9px] text-white/60 w-8">1.0x</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-blue-300 w-16">📏 Tamanho:</span>
                    <input 
                      type="range"
                      min="0.1"
                      max="10"
                      step="0.1"
                      defaultValue="2"
                      onChange={(e) => {
                        const value = parseFloat(e.target.value);
                        updateObjectPointSize(obj.name, value);
                        const display = e.target.nextElementSibling;
                        if (display) display.textContent = `${value.toFixed(1)}px`;
                      }}
                      className="flex-1 h-1"
                    />
                    <span className="text-[9px] text-white/60 w-8">2.0px</span>
                  </div>
                </div>
                
                <p className="text-[9px] text-gray-300 mt-1">Posição:</p>
                <div className="ml-2 flex items-center gap-1">
                  <span className="text-[9px] w-6">X:</span>
                  <input 
                    key={`${obj.name}-x-${obj.position.x}`}
                    type="number" 
                    step="0.1"
                    defaultValue={obj.position.x}
                    onChange={(e) => updateObjectPosition(obj.name, 'x', parseFloat(e.target.value) || 0)}
                    className="w-14 bg-white/10 border border-white/20 rounded px-1 text-[9px] text-white"
                  />
                </div>
                <div className="ml-2 flex items-center gap-1">
                  <span className="text-[9px] w-6">Y:</span>
                  <input 
                    key={`${obj.name}-y-${obj.position.y}`}
                    type="number" 
                    step="0.1"
                    defaultValue={obj.position.y}
                    onChange={(e) => updateObjectPosition(obj.name, 'y', parseFloat(e.target.value) || 0)}
                    className="w-14 bg-white/10 border border-white/20 rounded px-1 text-[9px] text-white"
                  />
                </div>
                <div className="ml-2 flex items-center gap-1">
                  <span className="text-[9px] w-6">Z:</span>
                  <input 
                    key={`${obj.name}-z-${obj.position.z}`}
                    type="number" 
                    step="0.1"
                    defaultValue={obj.position.z}
                    onChange={(e) => updateObjectPosition(obj.name, 'z', parseFloat(e.target.value) || 0)}
                    className="w-14 bg-white/10 border border-white/20 rounded px-1 text-[9px] text-white"
                  />
                </div>
                      <p className="text-[9px] text-gray-300 mt-1">Rotação (graus):</p>
                      <div className="ml-2 flex items-center gap-1">
                        <span className="text-[9px] w-6">X:</span>
                        <input 
                          type="number" 
                          step="1"
                          defaultValue={obj.rotation.x}
                          onChange={(e) => updateObjectRotation(obj.name, 'x', parseFloat(e.target.value) || 0)}
                          className="w-14 bg-white/10 border border-white/20 rounded px-1 text-[9px] text-white"
                        />
                        <span className="text-[9px] text-white/60">°</span>
                      </div>
                      <div className="ml-2 flex items-center gap-1">
                        <span className="text-[9px] w-6">Y:</span>
                        <input 
                          type="number" 
                          step="1"
                          defaultValue={obj.rotation.y}
                          onChange={(e) => updateObjectRotation(obj.name, 'y', parseFloat(e.target.value) || 0)}
                          className="w-14 bg-white/10 border border-white/20 rounded px-1 text-[9px] text-white"
                        />
                        <span className="text-[9px] text-white/60">°</span>
                      </div>
                      <div className="ml-2 flex items-center gap-1">
                        <span className="text-[9px] w-6">Z:</span>
                        <input 
                          type="number" 
                          step="1"
                          defaultValue={obj.rotation.z}
                          onChange={(e) => updateObjectRotation(obj.name, 'z', parseFloat(e.target.value) || 0)}
                          className="w-14 bg-white/10 border border-white/20 rounded px-1 text-[9px] text-white"
                        />
                        <span className="text-[9px] text-white/60">°</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-2 pt-2 border-t border-white/20 text-[9px] text-gray-400">
          <p>💡 Eixo UP: Z</p>
          <p>🔄 Atualização em tempo real</p>
          {useARCamera && (
            <>
              <p className="text-cyan-300 mt-1">📱 AR Camera Config:</p>
              <p>FOV: 53° (realista cross-device)</p>
              <p>Near: 0.01m / Far: 100m</p>
              <p>Escala: 1 unit = 1 metro</p>
              <p className="text-pink-300 mt-1">🎮 Fake 4DOF Ativo:</p>
              <p>Rotação + Posição baseada em giroscópio</p>
              <p>Mova o celular para ver o efeito!</p>
            </>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
