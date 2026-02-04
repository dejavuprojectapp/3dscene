# 🖱️ Sistema de Click e Modal para Objetos 3D

## 🎯 Arquitetura Implementada

Este sistema segue a **separação de responsabilidades** entre a cena 3D e a camada de UI, usando **CustomEvents** para comunicação desacoplada. Funciona em **🖱 Desktop | 📱 Mobile | ✏️ Caneta | 🥽 WebXR**.

## 🚀 Tecnologia: PointerEvents API

### Por que `pointerdown` e não `click`?

✅ **PointerEvents** funciona em todos os dispositivos:
- 🖱️ Mouse (desktop)
- 👆 Touch (mobile/tablet)
- ✏️ Stylus/Caneta
- 🥽 WebXR controllers

❌ **Problemas com `click` e `touchstart`**:
- `click`: Delay de 300ms em alguns mobiles
- `touchstart + mousedown`: Duplicam eventos
- Não funciona com stylus/WebXR

### Implementação Unificada

```typescript
// ✅ Um único sistema para todos os devices
canvas.addEventListener('pointerdown', onPointerDown)
canvas.addEventListener('pointermove', onPointerMove)

// ❌ Evite misturar eventos
canvas.addEventListener('click', ...)      // NÃO
canvas.addEventListener('touchstart', ...) // NÃO
canvas.addEventListener('mousedown', ...)  // NÃO
```

## 📋 Componentes do Sistema

### 1. Cena 3D (Three.js)
**Responsabilidade:** Detectar interações, **não manipular UI**

```typescript
// ❌ ERRADO: Cena manipula UI diretamente
setModalOpen(true)

// ✅ CORRETO: Cena emite evento
window.dispatchEvent(
  new CustomEvent('object-clicked', {
    detail: { name, mainImage, thumbnails, secondaryImage }
  })
)
```

### 2. Sistema de Input (Raycasting)
**Responsabilidade:** Converter cliques 2D em interações 3D

- **Click**: Detecta objetos clicáveis e dispara evento
- **Hover**: Fornece feedback visual (cursor, outline)

### 3. Camada de UI (React)
**Responsabilidade:** Reagir aos eventos e mostrar interfaces

```typescript
// UI escuta o evento da cena
window.addEventListener('object-clicked', (event) => {
  setSelectedObjectData(event.detail)
  setModalOpen(true)
})
```

## 🔄 Fluxo de Interação

```
Usuário interage (click/touch/stylus)
   ↓
pointerdown event disparado
   ↓
Verifica se não veio da UI (.ui-layer, button, input)
   ↓
Pega posição do pointer (2D)
   ↓
getBoundingClientRect() - evita bugs em layouts responsivos
   ↓
Converte para coordenadas normalizadas (-1 a 1)
   ↓
Lança Raycaster da câmera
   ↓
Ray intersecta objeto com userData.clickable?
   ↓
Sim → Emite CustomEvent 'object-clicked'
   ↓
React escuta evento
   ↓
Atualiza state e abre modal
```

## 🎨 Feedback Visual (UX)

### Hover State (Apenas Desktop)

```typescript
// ⚠️ Mobile não tem hover - só ativa se pointerType === 'mouse'
const handleCanvasPointerMove = (event: PointerEvent) => {
  if (event.pointerType !== 'mouse') return; // Ignora touch
  // ... raycast de hover
}
```

Quando o mouse passa sobre um objeto clickable (desktop only):

1. **Cursor**: Muda para `pointer`
2. **Outline**: Adiciona highlight cyan (emissive)
3. **Debug Panel**: Mostra status "Hover ativo"

### Mobile: Feedback ao Click

Como mobile não tem hover, o feedback visual é ao clicar:
- Vibração (se suportado)
- Modal aparece imediatamente
- Sem cursor pointer (não existe em touch)

### Implementação

```typescript
// Adiciona outline (emissive cyan)
const addOutline = (object: THREE.Object3D) => {
  object.traverse((child) => {
    if (child.isMesh && child.material) {
      // Salva emissive original
      userData.originalEmissive = material.emissive.clone()
      // Aplica highlight
      material.emissive.setHex(0x00ffff) // Cyan
    }
  })
}

// Remove outline (restaura original)
const removeOutline = (object: THREE.Object3D) => {
  // Restaura emissive original
  material.emissive.copy(userData.originalEmissive)
}
```

## 🔧 Como Ativar Clickable em um Objeto

### 1. Via Interface (Debug Panel)

1. Abra o Debug Panel (botão roxo "🔼 Mostrar Logs")
2. Encontre o objeto GLB desejado
3. Marque o checkbox **"🖱️ Clickable (abre modal)"**

Isso automaticamente:
- Marca `obj.clickable = true`
- Define `obj.userData.clickable = true` (convenção padrão)
- Define `obj.userData.payload = { id, type }`
- Inicializa `modalData` com imagens placeholder

### 2. Via Código

```typescript
toggleObjectClickable('model.glb', true)
```

### Convenção userData

Todos os objetos clickables seguem a convenção:

```typescript
mesh.userData = {
  clickable: true,
  payload: {
    id: 'helmet.glb',
    type: 'glb-model'
  }
}
```

Isso permite que outros sistemas identifiquem objetos interativos.

## 🖼️ Configuração do Modal

### Estrutura de Dados

```typescript
modalData: {
  mainImage: '/path/to/main-image.jpg',
  thumbnails: [
    '/path/to/thumb1.jpg',
    '/path/to/thumb2.jpg',
    '/path/to/thumb3.jpg'
  ],
  secondaryImage: '/path/to/secondary.jpg'
}
```

### Layout do Modal

```
┌─────────────────────────────────────┐
│  Model Name                      ✕  │
├─────────────────────────────────────┤
│  ┌───────────┐    ┌───────────┐    │
│  │           │    │           │    │
│  │  Main     │    │ Secondary │    │
│  │  Image    │    │  Image    │    │
│  │           │    │           │    │
│  └───────────┘    └───────────┘    │
│  [📷][📷][📷]                       │
│   Thumbnails                        │
├─────────────────────────────────────┤
│  Thumbnail 1 de 3                   │
└─────────────────────────────────────┘
```

### Responsividade

- **Mobile**: ~300px width
- **Desktop**: ~500-600px width
- **Posição**: Bottom center (fixed)
- **Backdrop**: Black 90% com blur

## 📤 Exportação JSON

Objetos clickables são exportados com todas as propriedades:

```json
{
  "objects": [
    {
      "name": "helmet.glb",
      "type": "glb",
      "clickable": true,
      "modalData": {
        "mainImage": "/images/helmet-main.jpg",
        "thumbnails": [
          "/images/helmet-1.jpg",
          "/images/helmet-2.jpg",
          "/images/helmet-3.jpg"
        ],
        "secondaryImage": "/images/helmet-detail.jpg"
      }
    }
  ]
}
```

## 🎮 Event Listeners

### Canvas Events

```typescript
// Click - Dispara quando objeto clickable é clicado
canvas.addEventListener('click', handleCanvasClick)

// Hover - Feedback visual em tempo real
canvas.addEventListener('mousemove', handleCanvasHover)
```

### CustomEvents

```typescript
// Cena emite
window.dispatchEvent(new CustomEvent('object-clicked', { detail }))

// UI escuta
window.addEventListener('object-clicked', handleObjectClicked)
```

## 🔍 Debug e Monitoramento

### Debug Panel - Seção Clickables

Mostra em tempo real:
- Lista de objetos com clickable ativo
- Estado de hover (destaque cyan quando ativo)
- Mensagem "Hover ativo - Click para abrir modal"

### Console Logs

```javascript
// Quando objeto é marcado como clickable
🖱️ Clickable ativado para: helmet.glb

// Quando objeto é clicado
🎯 Objeto clicado: helmet.glb

// Quando CustomEvent é recebido
📢 CustomEvent recebido: object-clicked { name: "helmet.glb", ... }
```

## 🎯 Best Practices Implementadas

### ✅ Separação de Responsabilidades

- **Cena**: Detecta interações, emite eventos
- **UI**: Escuta eventos, atualiza interface
- **Zero acoplamento** entre cena e UI

### ✅ Feedback Visual

- Cursor pointer ao passar sobre clickables
- Outline cyan (emissive) em hover
- Estado salvo/restaurado (originalEmissive)

### ✅ Performance

- Raycasting apenas em objetos clickables visíveis
- Hover throttling via mousemove (nativo)
- Cleanup automático de event listeners

### ✅ Acessibilidade

- Cursor pointer indica interatividade
- Feedback visual imediato (< 16ms)
- Modal pode ser fechado com botão ✕

## 🚀 Casos de Uso

### 1. Galeria de Produtos 3D
Objetos GLB representando produtos. Click abre modal com:
- Imagem principal do produto
- Galeria de ângulos (thumbnails)
- Detalhes técnicos (secondary image)

### 2. Tour Virtual com Informações
Objetos clickables em pontos de interesse. Modal mostra:
- Foto real do local
- Informações históricas
- Galeria de imagens relacionadas

### 3. Portfólio Interativo
Projetos em 3D. Click abre:
- Screenshot principal
- Wireframes/mockups (thumbnails)
- Diagrama de arquitetura

## 🔮 Futuro / Extensões

- [ ] Suporte para vídeos no modal
- [ ] Animações de transição (fade in/out)
- [ ] Múltiplos modais simultâneos
- [ ] Gestos touch (swipe para trocar thumbnail)
- [ ] Integração com CMS para conteúdo dinâmico
- [ ] Analytics de cliques nos objetos
- [ ] A/B testing de layouts de modal

## 📊 Comparação: Antes vs Depois

### ❌ Antes (Acoplado)
```typescript
// Cena manipula UI diretamente
if (clicked) {
  setModalOpen(true)  // 🔴 Acoplamento
  setData(...)        // 🔴 Cena conhece React state
}
```

### ✅ Depois (Desacoplado)
```typescript
// Cena emite evento
if (clicked) {
  window.dispatchEvent(
    new CustomEvent('object-clicked', { detail })
  )
}

// UI reage (em outro lugar)
window.addEventListener('object-clicked', handler)
```

**Vantagens:**
- ✅ Cena reutilizável (pode usar Vue, Angular, etc.)
- ✅ UI testável isoladamente
- ✅ Fácil adicionar múltiplos listeners
- ✅ Escalável para projetos grandes

## 🎓 Conceitos Aprendidos

1. **Raycasting**: Conversão de coordenadas 2D → 3D
2. **Event-Driven Architecture**: Comunicação via eventos
3. **Separation of Concerns**: Cena != UI
4. **Visual Feedback**: UX através de cursor + outline
5. **State Management**: React states para UI, refs para cena
6. **Cleanup**: Remoção de listeners e restauração de estado

---

**Implementado com ❤️ seguindo princípios SOLID e Clean Architecture**
