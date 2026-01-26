# Gaussian Splatting Viewer

Visualizador simples de Gaussian Splatting usando Next.js e Three.js.

## 🚀 Como usar

### 1. Instalar dependências
```bash
npm install
```

### 2. Adicionar seus modelos 3D
Coloque seus arquivos `.ply` ou `.splat` na pasta `public/models/`

### 3. Executar o projeto
```bash
npm run dev
```

### 4. Abrir no navegador
Acesse: http://localhost:3000

## 📁 Estrutura do Projeto

```
├── app/
│   ├── page.tsx          # Página de lobby (inicial)
│   ├── viewer/
│   │   └── page.tsx      # Visualizador 3D
│   ├── layout.tsx        # Layout principal
│   └── globals.css       # Estilos globais
├── public/
│   └── models/           # Coloque seus modelos .ply aqui
└── package.json
```

## 🎮 Controles do Visualizador

- **Rotação**: Clique e arraste
- **Zoom**: Scroll do mouse
- **Pan**: Botão direito + arrastar

## 📦 Tecnologias

- Next.js 16
- React Three Fiber
- Three.js
- TypeScript
- Tailwind CSS

## 📝 Notas

- Suporte para arquivos `.ply` (Point Cloud)
- Você pode alterar o caminho do modelo diretamente no visualizador
- Os modelos devem estar na pasta `public/models/`
