# 📚 Documentação - Gaussian Splatting + 3D Objects Viewer

## 🎯 Visão Geral

Aplicação Next.js com three.js que permite visualizar **Gaussian Splatting e objetos 3D na mesma cena**, com suporte a câmera AR simulada e controle de posicionamento em tempo real.

## ✨ Features Implementadas

### 🎨 Renderização Híbrida
- **Gaussian Splatting** (.ply, .splat) via `gaussian-splats-3d`
- **Modelos 3D** (.glb) via `GLTFLoader` do three.js
- **Mesma cena**: Ambos os formatos renderizados simultaneamente
- Sistema de coordenadas: **Z-axis UP**

### 📱 AR Camera Simulation
- **Camera 02 (AR)**: Simula câmera traseira de smartphone
  - FOV: 53° (realista cross-device)
  - Aspect ratio dinâmico baseado no stream de vídeo
  - Near: 0.01m, Far: 100m
  - Escala: 1 unidade = 1 metro
- **Video background**: Stream da câmera do dispositivo renderizado atrás da cena 3D
- **Permissões**: Detecção automática de HTTPS e gestão de permissões
- **HTTPS requirement**: Tunelamento via localtunnel para testes mobile

### 🎮 Fake 4DOF (4 Degrees of Freedom)
- **3DOF Rotation**: Giroscópio (DeviceOrientation)
  - Alpha (Yaw/Z), Beta (Pitch/X), Gamma (Roll/Y)
  - Rotação invertida para efeito de spatial lock
- **1DOF Position**: Parallax baseado em orientação delta
  - Sensibilidade: 0.05
  - Movimento suave com lerp (factor 0.1)
- **Acelerômetro**: DeviceMotion para dados de aceleração

### 🐛 Debug System
- **Overlay em tempo real** com toggle (botão roxo)
- **Camera info**: Posição, rotação, lookAt
- **Viewport calculations**: FOV, aspect, frustum, área visível
- **Device sensors**: Alpha, Beta, Gamma em tempo real
- **Objects tracking**: Posição e rotação de cada objeto
- **Frame counter**: Performance monitor
- **Status 4DOF**: Indicador quando ativo

### 🎯 Position Controls
- **Editable inputs**: X, Y, Z para cada objeto
- **Smooth transitions**: Lerp com factor 0.1
- **Target position system**: Posição desejada vs posição atual
- **Origin spawn**: Todos objetos nascem em (0, 0, 0)

### 📦 Multi-File Loading
- API automática: `/api/models` lista arquivos em `public/models/`
- **Suporte múltiplo**:
  - `.ply` - Point Cloud / Gaussian Splatting
  - `.splat` - Gaussian Splatting nativo
  - `.glb` - Modelos 3D (GLTF Binary)
- Carregamento assíncrono com progress feedback

### 📤 Export System
- **Export to JSON**: Exporta toda configuração da cena
  - Objetos 3D (posição, rotação, escala, visibilidade)
  - Câmera (posição, rotação, FOV, tipo AR/Principal)
  - Luzes (ambient, point, directional)
  - Environment (bloom, vignette, background)
  - Shaders aplicados aos objetos
  - Sistema de partículas (configurações globais e por objeto)
  - Metadados (versão, data de exportação)
- **Botão dedicado**: "📦 Exportar JSON" na interface principal
- **Auto-download**: Arquivo JSON baixado automaticamente
- Ver documentação completa: [EXPORT_SYSTEM.md](./EXPORT_SYSTEM.md)

## 📁 Estrutura de Arquivos

```
gaussian-first/
├── app/
│   ├── page.tsx              # Lobby (landing page)
│   ├── viewer/page.tsx       # Viewer interface
│   └── api/models/route.ts   # API de descoberta de arquivos
├── components/
│   └── Scene.tsx             # Engine principal (939 linhas)
├── public/
│   └── models/
│       ├── obj.glb           # ← Seu modelo 3D (adicione aqui)
│       ├── scene.splat       # Gaussian Splatting
│       └── splat.ply         # Point Cloud
└── README_AR.md              # Instruções de AR/HTTPS
```

## 🚀 Como Usar

### 1. Adicionar Modelos 3D

Coloque seus arquivos na pasta `public/models/`:

```bash
# Modelo GLB (obrigatório: nome obj.glb)
public/models/obj.glb

# Gaussian Splatting (opcional)
public/models/scene.splat
public/models/splat.ply
```

### 2. Iniciar Desenvolvimento

```bash
npm run dev
```

Servidor inicia em: `http://localhost:3001`

### 3. Testar no Mobile (AR Camera)

**HTTPS é obrigatório para câmera!**

```bash
# Terminal 1: Dev server
npm run dev

# Terminal 2: Tunnel HTTPS
npx localtunnel --port 3001
```

Acesse a URL gerada (ex: `https://lemon-wombats-lick.loca.lt`) no celular.

### 4. Interface

1. **Lobby**: Clique em "Iniciar Experiência"
2. **Viewer**: 
   - Selecione modelos (checkboxes na sidebar)
   - Botão azul: Ativar/Desativar AR Camera
   - Botão roxo: Mostrar/Esconder Debug Overlay
   - Inputs X/Y/Z: Ajustar posição de cada objeto
   - OrbitControls: Arrastar/scroll para navegar (Camera 01)

## 🎨 Renderização Híbrida em Ação

### Camera 01 (Orbit)
- **Uso**: Navegação livre, edição de cena
- FOV: 75°
- Posição inicial: (0, -8, 0)
- Controles: Mouse/touch drag + scroll

### Camera 02 (AR)
- **Uso**: Visualização imersiva com video background
- FOV: 53° (realista)
- Posição: (0, 0, 0) 
- Controles: DeviceOrientation + DeviceMotion

### Objetos na Mesma Cena

```typescript
// Scene.tsx - Linha ~407
const scene = new THREE.Scene();

// 1. Carrega Gaussian Splatting (.splat)
viewer = new GaussianSplats3D.Viewer({...});
await viewer.loadFile('/models/scene.splat');

// 2. Carrega Modelo 3D (.glb)
gltfLoader.load('/models/obj.glb', (gltf) => {
  scene.add(gltf.scene);
});

// 3. Carrega Point Cloud (.ply)
plyLoader.load('/models/splat.ply', (geometry) => {
  scene.add(mesh);
});

// Todos coexistem no mesmo THREE.Scene!
```

## 🧠 Sistema de Coordenadas

**Z-axis UP** (não Y-up padrão do three.js)

```typescript
camera.up.set(0, 0, 1);
cameraUp: [0, 0, 1]
```

- **X**: Left (-) / Right (+)
- **Y**: Back (-) / Forward (+)
- **Z**: Down (-) / Up (+)

## 📊 Arquitetura Técnica

### Stack
- **Framework**: Next.js 15.5.9 (App Router, Turbopack)
- **React**: 18.3.1 (compatibilidade com @react-three/fiber)
- **3D Engine**: three.js 0.171.0
- **Gaussian**: gaussian-splats-3d
- **Styling**: Tailwind CSS 3.4.17
- **TypeScript**: 5.7.2

### Loaders
- `PLYLoader` - Point clouds
- `GLTFLoader` - Modelos 3D
- `gaussian-splats-3d.Viewer` - Gaussian Splatting nativo

### Refs System
```typescript
sceneObjectsRef.current = [
  {
    name: 'obj.glb',
    object: THREE.Object3D,
    targetPosition: { x: 0, y: 0, z: 0 }
  },
  // ... outros objetos
];
```

### Animation Loop
```typescript
const animate = () => {
  // Fake 4DOF quando AR ativo
  if (useARCamera) {
    // Calcula delta de orientação
    // Aplica rotação invertida
    // Adiciona parallax
    // Lerp suave
  }
  
  // Atualiza aspect da câmera AR
  if (videoStream) {
    cameraAR.aspect = video.width / video.height;
  }
  
  renderer.render(scene, activeCamera);
  requestAnimationFrame(animate);
};
```

## 🔧 Configurações Avançadas

### Ajustar Sensibilidade 4DOF

Em `Scene.tsx` (~linha 535):

```typescript
// Rotação (mais sensível = multiplicador maior)
object.rotation.z = -deltaAlpha * 0.5; // padrão: 0.5
object.rotation.x = -deltaBeta * 0.5;
object.rotation.y = -deltaGamma * 0.5;

// Parallax (mais movimento = sensitivity maior)
const posX = targetPosition.x + (deltaGamma * 0.05); // padrão: 0.05
const posY = targetPosition.y + (deltaBeta * 0.05);

// Lerp (mais suave = factor menor)
object.position.x += (posX - object.position.x) * 0.1; // padrão: 0.1
```

### Adicionar Mais Formatos

Em `app/api/models/route.ts`:

```typescript
const supportedExtensions = ['ply', 'splat', 'glb', 'gltf']; // adicione aqui
```

Em `Scene.tsx`, adicione novo loader:

```typescript
const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');
// ... lógica de carregamento
```

## 🎯 Roadmap Futuro

- [ ] Suporte a múltiplos GLB (não apenas obj.glb)
- [ ] Suporte a .gltf (não-binário)
- [ ] Seleção de qual câmera usar na UI
- [ ] Gravação de vídeo da cena
- [ ] Export de posições (JSON)
- [ ] Drag & drop para upload de modelos
- [ ] Controle de escala por objeto
- [ ] Animações GLB (gltf.animations)

## 🐛 Troubleshooting

### Erro: "HTTPS_REQUIRED"
- **Causa**: getUserMedia precisa de HTTPS
- **Solução**: Use localtunnel ou ngrok

### Erro: "obj.glb não encontrado"
- **Causa**: Arquivo não está em public/models/
- **Solução**: Coloque seu GLB com nome exato: `obj.glb`

### Modelo GLB não aparece
- **Causa**: Escala muito pequena ou grande
- **Solução**: Ajuste no Blender ou use `.scale.set(10, 10, 10)`

### Gaussian Splatting não carrega
- **Causa**: Formato .spz não suportado
- **Solução**: Use .splat ou .ply

### Port 3000 in use
- **Causa**: Servidor anterior não foi fechado
- **Solução**: `pkill -f "next dev"` ou use porta 3001

## 📝 Notas Técnicas

### Por que React 18.3.1?
- @react-three/fiber tem peer dependency com React <19
- React 19 causa incompatibilidades com three.js ecosystem

### Por que Z-axis UP?
- Padrão em CAD/GIS/games
- Facilita trabalhar com Gaussian Splatting (geralmente Z-up)
- OrbitControls funciona nativamente com qualquer orientação

### Por que obj.glb fixo?
- Simplificação inicial (hardcoded)
- Facilita testes rápidos
- Futuras versões terão seleção dinâmica

## 📚 Referências

- [three.js Docs](https://threejs.org/docs/)
- [gaussian-splats-3d](https://github.com/mkkellogg/GaussianSplats3D)
- [Next.js Docs](https://nextjs.org/docs)
- [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [DeviceOrientation API](https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent)

---

**Versão**: 1.0.0  
**Última atualização**: Janeiro 2026  
**Autor**: Lucas @ Dejavu Soon
