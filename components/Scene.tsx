'use client';

import { useEffect, useRef, useState } from 'react';

interface SceneProps {
  modelPaths: string[];
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

export default function Scene({ modelPaths }: SceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [useARCamera, setUseARCamera] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sceneObjectsRef = useRef<Array<{ name: string; object: any; targetPosition: { x: number; y: number; z: number } }>>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cameraARRef = useRef<any>(null);
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
  const deviceMotionRef = useRef({ x: 0, y: 0, z: 0 });
  const initialOrientationRef = useRef({ alpha: 0, beta: 0, gamma: 0 });
  const isInitialOrientationSet = useRef(false);
  const sceneInitialized = useRef(false); // Flag para prevenir múltiplas inicializações

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

  useEffect(() => {
    if (!containerRef.current || modelPaths.length === 0) return;

    console.log('🔄 useEffect executado. ModelPaths:', modelPaths);
    console.log('🚦 sceneInitialized.current:', sceneInitialized.current);

    // Previne múltiplas inicializações simultâneas
    if (sceneInitialized.current) {
      console.warn('⚠️ AVISO: Tentativa de inicializar cena duplicada bloqueada!');
      return;
    }
    
    sceneInitialized.current = true;
    console.log('✅ Flag sceneInitialized definida como true');

    const cleanupFunctions: (() => void)[] = [];

    const init = async () => {
      if (!containerRef.current) return;

      // Limpa objetos anteriores para evitar duplicação
      sceneObjectsRef.current = [];
      console.log('🧹 SceneObjectsRef limpo antes de recarregar');
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

      // Handle PLY files (gaussian-splats-3d.Viewer removido para evitar duplicação)
      const plyFiles = modelPaths.filter(path => {
        const ext = path.split('.').pop()?.toLowerCase();
        return ext === 'ply';
      });

      if (plyFiles.length > 0) {
        console.log('📦 Carregando arquivos PLY:', plyFiles);

        const THREE = await import('three');
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
        const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

        const scene = new THREE.Scene();
        // Background transparente quando AR está ativo, preto quando não está
        scene.background = null; // Sempre transparente para ver o vídeo
        console.log('🎬 Nova cena criada | Objetos na cena:', scene.children.length);

        const camera = new THREE.PerspectiveCamera(
          75,
          containerRef.current.clientWidth / containerRef.current.clientHeight,
          0.1,
          1000
        );
        camera.position.set(0, -8, 0); // Posição ajustada para visão de cima
        camera.up.set(0, 0, 1); // Define Z como up
        camera.lookAt(0, 0, 0); // Olha para o centro da cena

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
        containerRef.current.appendChild(renderer.domElement);
        
        // Garante que o canvas fique sobre o vídeo mas com fundo transparente
        renderer.domElement.style.position = 'absolute';
        renderer.domElement.style.top = '0';
        renderer.domElement.style.left = '0';
        renderer.domElement.style.zIndex = '10'; // Acima do vídeo (z-index: 1)
        renderer.domElement.style.pointerEvents = 'auto'; // Permite interação com OrbitControls

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);

        const pointLight = new THREE.PointLight(0xffffff, 1);
        pointLight.position.set(10, 10, 10);
        scene.add(pointLight);
        console.log('💡 Luzes adicionadas | Total objetos na cena:', scene.children.length);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.screenSpacePanning = false; // Mantém Z como up durante pan
        controls.maxPolarAngle = Math.PI; // Permite rotação completa

        const loader = new PLYLoader();
        const gltfLoader = new GLTFLoader();

        // Array para rastrear objetos (usando ref global)
        sceneObjectsRef.current = [];

        // Carrega arquivo GLB
        gltfLoader.load(
          '/models/obj.glb',
          (gltf) => {
            // Verifica se já existe um objeto com esse nome na cena
            if (scene.getObjectByName('obj.glb')) {
              console.warn('⚠️ DUPLICAÇÃO BLOQUEADA: obj.glb já existe na cena!');
              return;
            }
            
            const model = gltf.scene;
            model.position.set(0, 0, 0); // Nasce na origem
            model.name = 'obj.glb';
            console.log('➕ Adicionando GLB à cena:', 'obj.glb', '| Total objetos na cena:', scene.children.length);
            scene.add(model);
            console.log('✅ GLB adicionado | Total objetos na cena:', scene.children.length);
            
            sceneObjectsRef.current.push({
              name: 'obj.glb',
              object: model,
              targetPosition: { x: 0, y: 0, z: 0 }
            });
          },
          undefined,
          (error) => {
            console.error('❌ Erro ao carregar obj.glb:', error);
          }
        );

        console.log('📋 Iniciando forEach para PLYs. Total de arquivos:', plyFiles.length, plyFiles);
        plyFiles.forEach((plyFile, index) => {
          console.log(`🔄 forEach iteração ${index}: Carregando`, plyFile);
          loader.load(
            plyFile,
            (geometry) => {
              geometry.computeVertexNormals();

              const material = new THREE.PointsMaterial({
                size: 0.015,
                vertexColors: true,
                sizeAttenuation: true,
              });

              const points = new THREE.Points(geometry, material);
              const fileName = plyFile.split('/').pop() || `PLY ${index}`;
              
              // Verifica se já existe um objeto com esse nome na cena
              if (scene.getObjectByName(fileName)) {
                console.warn('⚠️ DUPLICAÇÃO BLOQUEADA:', fileName, 'já existe na cena!');
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
              }

              console.log('➕ Adicionando PLY à cena:', fileName, '| Total objetos na cena antes:', scene.children.length);
              scene.add(points);
              console.log('✅ PLY adicionado:', fileName, '| Total objetos na cena depois:', scene.children.length);
              sceneObjectsRef.current.push({ name: fileName, object: points, targetPosition: { x: 0, y: 0, z: 0 } });
            },
            undefined,
            (error) => {
              console.error(`❌ Erro ao carregar PLY ${plyFile}:`, error);
            }
          );
        });

        let animationId: number;
        const animate = () => {
          animationId = requestAnimationFrame(animate);
          
          //  Fake 4DOF: Aplica movimento baseado em device orientation + motion
          if (useARCamera && isInitialOrientationSet.current) {
            sceneObjectsRef.current.forEach(({ object, targetPosition }) => {
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
            });
          } else {
            // Modo normal: apenas lerp para targetPosition
            sceneObjectsRef.current.forEach(({ object, targetPosition }) => {
              const lerpFactor = 0.1;
              object.position.x += (targetPosition.x - object.position.x) * lerpFactor;
              object.position.y += (targetPosition.y - object.position.y) * lerpFactor;
              object.position.z += (targetPosition.z - object.position.z) * lerpFactor;
            });
          }

          // Seleciona câmera ativa
          const activeCamera = useARCamera ? cameraAR : camera;

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
          
          // Atualiza controles apenas para câmera principal
          if (!useARCamera) {
            controls.update();
          }
          
          renderer.render(scene, activeCamera);
          
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

        cleanupFunctions.push(() => {
          if (animationId) cancelAnimationFrame(animationId);
          window.removeEventListener('resize', handleResize);
          controls.dispose();
          
          // Limpa todos os objetos da cena
          scene.traverse((object) => {
            if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
              object.geometry?.dispose();
              if (Array.isArray(object.material)) {
                object.material.forEach(mat => mat.dispose());
              } else {
                object.material?.dispose();
              }
            }
          });
          scene.clear();
          
          if (containerRef.current && containerRef.current.contains(renderer.domElement)) {
            containerRef.current.removeChild(renderer.domElement);
          }
          renderer.dispose();
          console.log('🗑️ Renderer e objetos da cena descartados');
        });
      }
    };

    init();

    return () => {
      console.log('🧹 Iniciando cleanup...');
      cleanupFunctions.forEach(fn => fn());
      stopARCamera(); // Cleanup camera stream
      sceneObjectsRef.current = []; // Limpa referências de objetos
      sceneInitialized.current = false; // Reset flag para permitir nova inicialização
      console.log('✅ Cleanup completo: cena e objetos removidos, flag resetada');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelPaths]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full" 
      style={{ position: 'relative', background: useARCamera ? 'transparent' : '#000', overflow: 'hidden' }} 
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
        </div>

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

        {/* Objects Info */}
        <div>
          <p className="font-semibold text-blue-300 mb-1">🎯 Objetos na Cena:</p>
          {debugInfo.objects.length === 0 ? (
            <p className="text-gray-400 text-[10px]">Carregando...</p>
          ) : (
            debugInfo.objects.map((obj, idx) => (
              <div key={`${obj.name}-${idx}`} className="mb-3 pl-2 border-l-2 border-blue-500/30">
                <p className="text-[10px] font-semibold text-white/90">{obj.name}</p>
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
                <p className="ml-2 text-[9px]">X: {obj.rotation.x}°</p>
                <p className="ml-2 text-[9px]">Y: {obj.rotation.y}°</p>
                <p className="ml-2 text-[9px]">Z: {obj.rotation.z}°</p>
              </div>
            ))
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
