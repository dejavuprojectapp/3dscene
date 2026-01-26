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
  const [frameCount, setFrameCount] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sceneObjectsRef = useRef<Array<{ name: string; object: any; targetPosition: { x: number; y: number; z: number } }>>([]);
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

  useEffect(() => {
    if (!containerRef.current || modelPaths.length === 0) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viewer: any = null;
    const cleanupFunctions: (() => void)[] = [];

    const init = async () => {
      if (!containerRef.current) return;

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

      // Check for .splat files (gaussian-splats-3d only supports .splat and .ply)
      const splatFile = modelPaths.find(path => {
        const ext = path.split('.').pop()?.toLowerCase();
        return ext === 'splat';
      });

      if (splatFile) {
        console.log('📦 Carregando Gaussian Splatting:', splatFile);
        
        try {
          const GaussianSplats3D = await import('gaussian-splats-3d');
          
          console.log('✓ Biblioteca gaussian-splats-3d carregada');
          console.log('Conteúdo da biblioteca:', Object.keys(GaussianSplats3D));

          viewer = new GaussianSplats3D.Viewer({
            cameraUp: [0, 0, 1],
            initialCameraPosition: [0, 0, 5],
            initialCameraLookAt: [0, 0, 0],
            rootElement: containerRef.current,
          });

          console.log('✓ Viewer criado');

          // Initialize and load the splat file
          await viewer.init();
          console.log('✓ Viewer inicializado');

          // Load the scene using the correct method
          await viewer.loadFile(splatFile, {
            progressiveLoad: true,
          });
          
          console.log('✅ Gaussian Splatting carregado com sucesso!');

          cleanupFunctions.push(() => {
            if (viewer) {
              viewer.dispose();
            }
          });

        } catch (error) {
          console.error('❌ Erro ao inicializar Gaussian Splatting:', error);
          console.error('Stack:', error);
        }
      }

      // Handle PLY files
      const plyFiles = modelPaths.filter(path => {
        const ext = path.split('.').pop()?.toLowerCase();
        return ext === 'ply';
      });

      if (plyFiles.length > 0) {
        console.log('📦 Carregando arquivos PLY:', plyFiles);

        const THREE = await import('three');
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
        const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);

        const camera = new THREE.PerspectiveCamera(
          75,
          containerRef.current.clientWidth / containerRef.current.clientHeight,
          0.1,
          1000
        );
        camera.position.set(0, -8, 0); // Posição ajustada para visão de cima
        camera.up.set(0, 0, 1); // Define Z como up
        camera.lookAt(0, 0, 0); // Olha para o centro da cena

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        containerRef.current.appendChild(renderer.domElement);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);

        const pointLight = new THREE.PointLight(0xffffff, 1);
        pointLight.position.set(10, 10, 10);
        scene.add(pointLight);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.screenSpacePanning = false; // Mantém Z como up durante pan
        controls.maxPolarAngle = Math.PI; // Permite rotação completa

        const loader = new PLYLoader();

        // Adiciona cubo verde como placeholder para futuro GLB
        const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
        const cubeMaterial = new THREE.MeshStandardMaterial({ 
          color: 0x00ff00,
          metalness: 0.3,
          roughness: 0.7
        });
        const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
        cube.position.set(0, 0, 0); // Nasce na origem
        cube.name = 'Cubo Verde (Placeholder GLB)';
        scene.add(cube);
        console.log('📦 Cubo verde adicionado como placeholder para GLB');

        // Array para rastrear objetos (usando ref global)
        sceneObjectsRef.current = [
          { name: 'Cubo Verde (Placeholder GLB)', object: cube, targetPosition: { x: 0, y: 0, z: 0 } }
        ];
        console.log('📋 SceneObjectsRef inicializado:', sceneObjectsRef.current.map(o => o.name));

        plyFiles.forEach((plyFile, index) => {
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

              scene.add(points);
              sceneObjectsRef.current.push({ name: fileName, object: points, targetPosition: { x: 0, y: 0, z: 0 } });
              console.log(`✅ PLY carregado: ${plyFile}`);
              console.log('📋 Objetos no sceneObjectsRef:', sceneObjectsRef.current.map(o => o.name));
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
          
          // Aplica smooth transition (lerp) para todas as posições
          sceneObjectsRef.current.forEach(({ object, targetPosition }) => {
            const lerpFactor = 0.1; // Quanto menor, mais suave (0.05 = muito suave, 0.2 = rápido)
            object.position.x += (targetPosition.x - object.position.x) * lerpFactor;
            object.position.y += (targetPosition.y - object.position.y) * lerpFactor;
            object.position.z += (targetPosition.z - object.position.z) * lerpFactor;
          });
          
          // Atualiza a cada frame (sem throttle para garantir tempo real)
          controls.update();
          renderer.render(scene, camera);
          
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
          
          // Log em tempo real a cada 60 frames (~1 segundo em 60fps)
          if (frameCount % 60 === 0) {
            console.log('📊 DEBUG INFO (Tempo Real):');
            console.log('📹 Camera:', newDebugInfo.camera);
            console.log('🔄 Camera Rotation:', newDebugInfo.cameraRotation);
            console.log('👀 Look At:', newDebugInfo.lookAt);
            console.log('📐 Viewport:', {
              resolution: `${newDebugInfo.viewport.width}x${newDebugInfo.viewport.height}`,
              aspect: newDebugInfo.viewport.aspect,
              fov: `${newDebugInfo.viewport.fov}°`,
              frustum: `${newDebugInfo.viewport.frustumWidth}x${newDebugInfo.viewport.frustumHeight}`,
              distance: newDebugInfo.viewport.distanceToOrigin,
              visibleArea: newDebugInfo.viewport.visibleArea,
            });
            console.log('📦 Objects:', newDebugInfo.objects);
            console.log('---');
          }
          
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
          if (containerRef.current && containerRef.current.contains(renderer.domElement)) {
            containerRef.current.removeChild(renderer.domElement);
          }
          renderer.dispose();
        });
      }
    };

    init();

    return () => {
      cleanupFunctions.forEach(fn => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelPaths]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full" 
      style={{ position: 'relative', background: '#000' }} 
    >
      {/* Debug Info Overlay */}
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
          <p className="font-semibold text-yellow-300 mb-1">📷 Câmera:</p>
          <p className="text-[10px]">Posição:</p>
          <p className="ml-2">X: {debugInfo.camera.x}</p>
          <p className="ml-2">Y: {debugInfo.camera.y}</p>
          <p className="ml-2">Z: {debugInfo.camera.z}</p>
          <p className="text-[10px] mt-1">Rotação (graus):</p>
          <p className="ml-2">X: {debugInfo.cameraRotation.x}°</p>
          <p className="ml-2">Y: {debugInfo.cameraRotation.y}°</p>
          <p className="ml-2">Z: {debugInfo.cameraRotation.z}°</p>
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
        </div>
      </div>
    </div>
  );
}
