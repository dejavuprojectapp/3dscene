import { readdir } from 'fs/promises';
import { join } from 'path';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const modelsDirectory = join(process.cwd(), 'public', 'models');
    const files = await readdir(modelsDirectory);
    
    // Filter only supported file types (gaussian-splats-3d only supports .ply and .splat)
    const supportedFiles = files.filter(file => {
      const ext = file.toLowerCase().split('.').pop();
      return ['ply', 'splat'].includes(ext || '');
    });

    return NextResponse.json({ files: supportedFiles });
  } catch (error) {
    console.error('Error reading models directory:', error);
    return NextResponse.json({ files: [] });
  }
}
