# Coloque seus modelos 3D aqui

⚠️ **FORMATOS SUPORTADOS pela biblioteca gaussian-splats-3d:**
- ✅ `.ply` (Point Cloud)
- ✅ `.splat` (Gaussian Splatting)
- ❌ `.spz` NÃO É SUPORTADO (precisa ser convertido para .splat)

## Como converter .spz para .splat:

### Opção 1: SuperSplat (Online/Desktop)
1. Acesse: https://playcanvas.com/supersplat/editor
2. Carregue seu arquivo .spz
3. Exporte como .splat ou .ply

### Opção 2: Linha de comando (se tiver Python)
```bash
# Instale a biblioteca
pip install plyfile

# Use uma ferramenta de conversão como:
# https://github.com/antimatter15/splat
```

## Exemplo de arquivos suportados:
- model.ply
- gaussian.splat

⚠️ Renomeie ou converta seu `scene.spz` para `scene.splat`
