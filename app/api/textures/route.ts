import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const texturesDirectory = path.join(process.cwd(), 'public', 'textures');
    
    // Verifica se o diretório existe
    if (!fs.existsSync(texturesDirectory)) {
      console.log('⚠️ Diretório public/textures não existe. Criando...');
      fs.mkdirSync(texturesDirectory, { recursive: true });
      return NextResponse.json({ files: [] });
    }

    const files = fs.readdirSync(texturesDirectory);
    
    // Filtra apenas arquivos .png, .jpg, .jpeg e .hdr
    const supportedFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.png', '.jpg', '.jpeg', '.hdr'].includes(ext);
    });

    console.log('🖼️ Texturas encontradas:', supportedFiles);

    return NextResponse.json({ files: supportedFiles });
  } catch (error) {
    console.error('❌ Erro ao ler diretório de texturas:', error);
    return NextResponse.json({ files: [], error: 'Failed to read textures directory' }, { status: 500 });
  }
}
