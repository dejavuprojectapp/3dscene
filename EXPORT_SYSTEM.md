# 📦 Sistema de Exportação de Cena - JSON

## Visão Geral

O sistema de exportação permite salvar todo o estado atual da cena 3D em um arquivo JSON estruturado, incluindo:

- ✅ Objetos 3D (posição, rotação, escala, visibilidade, opacity)
- ✅ Câmera (posição, rotação, FOV, tipo AR/Principal)
- ✅ Luzes (ambient, point, directional com intensidades)
- ✅ Environment (bloom, vignette, tone mapping, textura de fundo)
- ✅ Shaders aplicados (PLY custom, equirectangular reflection, PBR)
- ✅ Sistema de partículas (configurações globais e por objeto)
- ✅ Metadados (versão, data de exportação)

## Como Usar

1. Configure sua cena com objetos, câmera, luzes e efeitos desejados
2. Clique no botão **"📦 Exportar JSON"** no topo da interface
3. Um arquivo JSON será baixado automaticamente com nome `scene-export-YYYY-MM-DD.json`

## Estrutura do JSON Exportado

### Exemplo Completo

```json
{
  "version": "1.0.0",
  "exportDate": "2026-02-03T10:30:00.000Z",
  
  "camera": {
    "type": "PerspectiveCamera",
    "position": { "x": 0, "y": 0, "z": 8 },
    "rotation": { "x": 0, "y": 0, "z": 0 },
    "fov": 75,
    "aspect": 1.778,
    "near": 0.1,
    "far": 1000,
    "lookAt": { "x": 0, "y": 0, "z": 0 },
    "isAR": false
  },
  
  "lights": {
    "ambient": {
      "intensity": 1.5,
      "color": "#ffffff"
    },
    "point": {
      "intensity": 2.0,
      "color": "#ffffff",
      "position": { "x": 10, "y": 10, "z": 10 }
    },
    "directional": {
      "intensity": 1.5,
      "color": "#ffffff",
      "position": { "x": 5, "y": 5, "z": 5 }
    }
  },
  
  "environment": {
    "backgroundTexture": "/textures/Rotunda/Rotunda.json",
    "backgroundEnabled": true,
    "bloom": {
      "enabled": true,
      "intensity": 1.5,
      "threshold": 0.2
    },
    "vignette": {
      "offset": 1.1,
      "darkness": 1.3
    },
    "toneMapping": "ACESFilmic",
    "toneMappingExposure": 1.0
  },
  
  "objects": [
    {
      "name": "model.glb",
      "type": "glb",
      "filePath": "/models/model.glb",
      "position": { "x": 0, "y": 0, "z": 0 },
      "rotation": { "x": 0, "y": 0, "z": 0 },
      "scale": { "x": 1, "y": 1, "z": 1 },
      "visible": true,
      "opacity": 1.0,
      "shader": {
        "type": "equirectangularReflection",
        "uniforms": {
          "uBrightness": 1.0,
          "uFresnelPower": 5.0,
          "uMetalness": 1.0,
          "uMetalColor": { "r": 1.0, "g": 0.85, "b": 0.55 },
          "uUseMetal": true,
          "uReflectionStrength": 1.0,
          "uHologramEnabled": false,
          "uHologramIntensity": 0.03,
          "uHologramFrequency": 20.0,
          "uHologramSpeed": 2.0,
          "uFeatherEnabled": false,
          "uFeatherRadius": 0.7,
          "uFeatherSoftness": 0.2,
          "uBlackHoleEnabled": true,
          "uBlackHoleDarkColor": { "r": 0.01, "g": 0.0, "b": 0.03 },
          "uBlackHoleBrightColor": { "r": 0.9, "g": 0.6, "b": 1.2 },
          "uBlackHoleIntensity": 0.3
        }
      },
      "material": {
        "type": "MeshStandardMaterial",
        "properties": {
          "color": "#ffffff",
          "metalness": 0.5,
          "roughness": 0.5,
          "emissive": "#000000",
          "emissiveIntensity": 0.0
        }
      },
      "particleSystem": {
        "enabled": true,
        "density": 1.0,
        "speed": 0.8,
        "vortexStrength": 1.0,
        "curlStrength": 1.0,
        "size": 1.0,
        "burstStrength": 3.0,
        "settleTime": 1.5,
        "attractorStrength": 0.0,
        "orbitDistance": 1.2,
        "orbitSpeed": 1.0,
        "followCamera": true
      }
    },
    {
      "name": "pointcloud.ply",
      "type": "ply",
      "filePath": "/models/pointcloud.ply",
      "position": { "x": 2, "y": 0, "z": 0 },
      "rotation": { "x": 90, "y": 180, "z": 0 },
      "scale": { "x": 0.5, "y": 0.5, "z": 0.5 },
      "visible": true,
      "opacity": 0.8,
      "shader": {
        "type": "plyCustomShader",
        "uniforms": {
          "uOpacity": 0.8,
          "uBrightness": 1.0,
          "uPointSize": 2.0
        }
      }
    }
  ],
  
  "shaders": {
    "equirectangularReflection": {
      "enabled": true,
      "appliedToObjects": ["model.glb"],
      "fresnelPower": 5.0,
      "brightness": 1.0,
      "metalness": 1.0,
      "metalColor": { "r": 1.0, "g": 0.85, "b": 0.55 },
      "useMetal": true,
      "reflectionStrength": 1.0,
      "hologram": {
        "enabled": false,
        "intensity": 0.03,
        "frequency": 20.0,
        "speed": 2.0
      },
      "feather": {
        "enabled": false,
        "radius": 0.7,
        "softness": 0.2
      },
      "blackHole": {
        "enabled": true,
        "darkColor": { "r": 0.01, "g": 0.0, "b": 0.03 },
        "brightColor": { "r": 0.9, "g": 0.6, "b": 1.2 },
        "intensity": 0.3
      }
    }
  },
  
  "particles": {
    "globalEnabled": true,
    "density": 1.0,
    "speed": 0.8,
    "vortexStrength": 1.0,
    "curlStrength": 1.0,
    "size": 1.0,
    "burstStrength": 3.0,
    "settleTime": 1.5,
    "attractorStrength": 0.0,
    "orbitDistance": 1.2,
    "orbitSpeed": 1.0,
    "followCamera": true,
    "debugEdgeTexture": false
  }
}
```

## Propriedades Detalhadas

### Camera

| Propriedade | Tipo | Descrição |
|------------|------|-----------|
| `type` | string | Tipo da câmera (`PerspectiveCamera` ou `OrthographicCamera`) |
| `position` | object | Posição XYZ da câmera no espaço 3D |
| `rotation` | object | Rotação em graus (X, Y, Z) |
| `fov` | number | Field of View (campo de visão) em graus |
| `aspect` | number | Aspect ratio (largura/altura) |
| `near` | number | Near clipping plane |
| `far` | number | Far clipping plane |
| `lookAt` | object | Ponto XYZ para onde a câmera está olhando |
| `isAR` | boolean | Se está no modo AR (câmera do dispositivo) |

### Lights

#### Ambient Light
- `intensity`: Intensidade da luz ambiente (0.0 - 5.0)
- `color`: Cor em hexadecimal

#### Point Light
- `intensity`: Intensidade (0.0 - 10.0)
- `color`: Cor em hexadecimal
- `position`: Posição XYZ da fonte de luz

#### Directional Light
- `intensity`: Intensidade (0.0 - 5.0)
- `color`: Cor em hexadecimal
- `position`: Posição XYZ (direção da luz)

### Environment

| Propriedade | Tipo | Descrição |
|------------|------|-----------|
| `backgroundTexture` | string\|null | Caminho para textura HDRI/PNG de fundo |
| `backgroundEnabled` | boolean | Se a textura de fundo está ativa |
| `bloom.enabled` | boolean | Ativa efeito de bloom |
| `bloom.intensity` | number | Intensidade do bloom (0.0 - 5.0) |
| `bloom.threshold` | number | Threshold de luminosidade (0.0 - 1.0) |
| `vignette.offset` | number | Tamanho da vinheta (0.0 - 2.0) |
| `vignette.darkness` | number | Escuridão da vinheta (0.0 - 3.0) |
| `toneMapping` | string | Algoritmo de tone mapping |
| `toneMappingExposure` | number | Exposição do tone mapping |

### Objects

Cada objeto contém:

| Propriedade | Tipo | Descrição |
|------------|------|-----------|
| `name` | string | Nome do arquivo do objeto |
| `type` | string | Tipo (`ply`, `splat`, `glb`, `gltf`) |
| `filePath` | string | Caminho completo do arquivo |
| `position` | object | Posição XYZ |
| `rotation` | object | Rotação em graus (X, Y, Z) |
| `scale` | object | Escala XYZ |
| `visible` | boolean | Visibilidade do objeto |
| `opacity` | number | Opacidade (0.0 - 1.0) |
| `shader` | object\|undefined | Configuração de shader aplicado |
| `material` | object\|undefined | Propriedades do material |
| `particleSystem` | object\|undefined | Sistema de partículas (se ativo) |

### Shaders

#### PLY Custom Shader (`plyCustomShader`)
```json
{
  "type": "plyCustomShader",
  "uniforms": {
    "uOpacity": 1.0,
    "uBrightness": 1.0,
    "uPointSize": 2.0
  }
}
```

#### Equirectangular Reflection (`equirectangularReflection`)
```json
{
  "type": "equirectangularReflection",
  "uniforms": {
    "uBrightness": 1.0,
    "uFresnelPower": 5.0,
    "uMetalness": 1.0,
    "uMetalColor": { "r": 1.0, "g": 0.85, "b": 0.55 },
    "uUseMetal": true,
    "uReflectionStrength": 1.0,
    "uHologramEnabled": false,
    "uHologramIntensity": 0.03,
    "uHologramFrequency": 20.0,
    "uHologramSpeed": 2.0,
    "uFeatherEnabled": false,
    "uFeatherRadius": 0.7,
    "uFeatherSoftness": 0.2,
    "uBlackHoleEnabled": true,
    "uBlackHoleDarkColor": { "r": 0.01, "g": 0.0, "b": 0.03 },
    "uBlackHoleBrightColor": { "r": 0.9, "g": 0.6, "b": 1.2 },
    "uBlackHoleIntensity": 0.3
  }
}
```

#### PBR Shader (`pbr`)
```json
{
  "type": "pbr"
}
```

### Particle System

Configuração do sistema de partículas:

| Propriedade | Tipo | Range | Descrição |
|------------|------|-------|-----------|
| `enabled` | boolean | - | Ativa/desativa partículas |
| `density` | number | 0.5 - 2.0 | Densidade de partículas |
| `speed` | number | 0.3 - 1.5 | Velocidade de movimento |
| `vortexStrength` | number | 0.3 - 2.0 | Força do vórtice |
| `curlStrength` | number | 0.3 - 2.0 | Força do curl noise |
| `size` | number | 0.3 - 2.0 | Tamanho das partículas |
| `burstStrength` | number | 0.5 - 5.0 | Força do burst inicial |
| `settleTime` | number | 0.5 - 3.0 | Tempo para estabilizar (segundos) |
| `attractorStrength` | number | 0.0 - 2.0 | Força de atração orbital (0 = vortex, 2 = orbital) |
| `orbitDistance` | number | 0.5 - 2.0 | Raio da órbita |
| `orbitSpeed` | number | 0.5 - 3.0 | Velocidade de rotação orbital |
| `followCamera` | boolean | - | Partículas seguem rotação da câmera |

## Casos de Uso

### 1. Salvar Configuração de Cena
Exporte a cena atual para reutilizar a mesma configuração em outra sessão.

### 2. Backup de Estado
Crie backups incrementais durante o desenvolvimento para poder reverter mudanças.

### 3. Compartilhamento de Setup
Compartilhe configurações exatas com outros desenvolvedores.

### 4. Documentação de Projetos
Use o JSON exportado como documentação técnica do projeto.

### 5. Versionamento de Cenas
Versione diferentes configurações de cena usando Git ou sistema de arquivos.

### 6. Importação Futura (Planejado)
Em versões futuras, será possível importar o JSON para recriar cenas automaticamente.

## Notas Técnicas

- **Precisão**: Valores numéricos são arredondados para 2-3 casas decimais para reduzir tamanho do arquivo
- **Rotações**: Todas as rotações são exportadas em graus (não radianos)
- **Cores**: Cores são exportadas como objetos RGB { r, g, b } com valores 0.0-1.0
- **Versão**: O campo `version` permite compatibilidade futura com diferentes formatos

## Roadmap Futuro

- [ ] Importar JSON para restaurar cena completa
- [ ] Exportar animações de câmera
- [ ] Suporte para múltiplas cenas em um arquivo
- [ ] Compressão opcional do JSON
- [ ] Validação de schema JSON
- [ ] Presets de configuração comum

## Exemplo Prático

```bash
# 1. Configure sua cena no viewer
# 2. Clique em "📦 Exportar JSON"
# 3. Arquivo baixado: scene-export-2026-02-03.json

# Você pode versionar o arquivo:
git add scene-export-2026-02-03.json
git commit -m "Save scene configuration with particles and bloom"

# Ou usar como backup:
cp scene-export-2026-02-03.json backups/
```

## Troubleshooting

### Botão desabilitado
O botão "Exportar JSON" só funciona quando a cena está ativa. Certifique-se de marcar "▶️ Iniciar Cena" primeiro.

### JSON muito grande
Se o arquivo JSON estiver muito grande, considere:
- Reduzir número de objetos na cena
- Minimizar o JSON manualmente se necessário
- Usar compressão externa (gzip)

### Valores inesperados
- Rotações são sempre em graus, não radianos
- Posições são relativas à origem (0,0,0)
- Cores RGB usam valores 0.0-1.0, não 0-255
