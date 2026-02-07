'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const Scene = dynamic(() => import('@/components/Scene'), {
  ssr: false,
});

export default function ViewerPage() {
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [availableTextures, setAvailableTextures] = useState<string[]>([]);
  const [selectedTexture, setSelectedTexture] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingTextures, setLoadingTextures] = useState(true);

  useEffect(() => {
    // Fetch available models from the API
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        const models = data.files.map((file: string) => `/models/${file}`);
        setAvailableModels(models);
        // Select all models by default
        setSelectedModels(models);
        setLoading(false);
      })
      .catch(error => {
        console.error('Erro ao buscar modelos:', error);
        setLoading(false);
      });

    // Fetch available textures from the API
    fetch('/api/textures')
      .then(res => res.json())
      .then(data => {
        const textures = data.files.map((file: string) => `/textures/${file}`);
        setAvailableTextures(textures);
        // 🎯 Auto-seleciona a primeira textura disponível
        if (textures.length > 0) {
          setSelectedTexture(textures[0]);
          console.log('✅ Textura selecionada automaticamente:', textures[0]);
        }
        setLoadingTextures(false);
      })
      .catch(error => {
        console.error('Erro ao buscar texturas:', error);
        setLoadingTextures(false);
      });
  }, []);

  const toggleModel = (modelPath: string) => {
    setSelectedModels(prev => {
      if (prev.includes(modelPath)) {
        return prev.filter(m => m !== modelPath);
      } else {
        return [...prev, modelPath];
      }
    });
  };

  return (
    <div className="w-full h-screen relative overflow-hidden">
      <div className="absolute top-2 sm:top-4 left-2 sm:left-4 z-10 space-y-2 sm:space-y-4 max-h-[90vh] overflow-y-auto max-w-[90vw] sm:max-w-md">
        <Link
          href="/"
          className="block px-3 sm:px-6 py-2 sm:py-3 bg-blue-600 text-white text-sm sm:text-base rounded-lg hover:bg-blue-700 transition-colors touch-manipulation"
        >
          ← Voltar
        </Link>
        
        <div className="bg-black/50 backdrop-blur-sm p-3 sm:p-4 rounded-lg">
          <h2 className="text-white font-semibold mb-2 sm:mb-3 text-sm sm:text-base">Modelos Disponíveis:</h2>
          
          {loading ? (
            <p className="text-gray-400 text-sm">Carregando...</p>
          ) : availableModels.length === 0 ? (
            <div>
              <p className="text-yellow-400 text-sm mb-2">Nenhum modelo encontrado</p>
              <p className="text-xs text-gray-400">
                Coloque arquivos .ply, .splat ou .glb em public/models/
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {availableModels.map((model, index) => {
                const fileName = model.split('/').pop();
                const isSelected = selectedModels.includes(model);
                
                return (
                  <label 
                    key={model}
                    className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 p-2 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleModel(model)}
                      className="w-3 h-3 sm:w-4 sm:h-4"
                    />
                    <span className="text-white text-xs sm:text-sm">
                      {index + 1}. {fileName}
                    </span>
                  </label>
                );
              })}
              
              <div className="pt-2 mt-2 border-t border-white/20">
                <p className="text-xs text-gray-400">
                  ✓ {selectedModels.length} modelo(s) selecionado(s)
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Modelos posicionados em profundidade
                </p>
              </div>
            </div>
          )}
          
          <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-white/20">
            <p className="text-xs text-gray-400">
              Suporta: .ply, .splat, .glb
            </p>
          </div>
        </div>

        {/* Seção de Texturas */}
        <div className="bg-black/50 backdrop-blur-sm p-3 sm:p-4 rounded-lg">
          <h2 className="text-white font-semibold mb-2 sm:mb-3 text-sm sm:text-base">Texturas Disponíveis:</h2>
          
          {loadingTextures ? (
            <p className="text-gray-400 text-sm">Carregando...</p>
          ) : availableTextures.length === 0 ? (
            <div>
              <p className="text-yellow-400 text-sm mb-2">Nenhuma textura encontrada</p>
              <p className="text-xs text-gray-400">
                Coloque arquivos .png, .jpg ou .hdr em public/textures/
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="mb-3">
                <label className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 p-2 rounded">
                  <input
                    type="radio"
                    name="texture"
                    checked={selectedTexture === null}
                    onChange={() => setSelectedTexture(null)}
                    className="w-3 h-3 sm:w-4 sm:h-4"
                  />
                  <span className="text-white text-xs sm:text-sm">
                    Nenhuma (fundo padrão)
                  </span>
                </label>
              </div>
              
              {availableTextures.map((texture, index) => {
                const fileName = texture.split('/').pop();
                const isSelected = selectedTexture === texture;
                
                return (
                  <label 
                    key={texture}
                    className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 p-2 rounded"
                  >
                    <input
                      type="radio"
                      name="texture"
                      checked={isSelected}
                      onChange={() => setSelectedTexture(texture)}
                      className="w-3 h-3 sm:w-4 sm:h-4"
                    />
                    <span className="text-white text-xs sm:text-sm">
                      {index + 1}. {fileName}
                    </span>
                  </label>
                );
              })}
              
              <div className="pt-2 mt-2 border-t border-white/20">
                <p className="text-xs text-gray-400">
                  {selectedTexture ? `✓ ${selectedTexture.split('/').pop()}` : '○ Sem textura'}
                </p>
              </div>
            </div>
          )}
          
          <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-white/20">
            <p className="text-xs text-gray-400">
              Suporta: .png, .jpg, .hdr
            </p>
          </div>
        </div>
      </div>

      {!loading && selectedModels.length > 0 && (
        <Scene modelPaths={selectedModels} texturePath={selectedTexture} />
      )}
      
      {!loading && selectedModels.length === 0 && (
        <div className="w-full h-full flex items-center justify-center px-4">
          <p className="text-white text-base sm:text-xl text-center">Selecione pelo menos um modelo</p>
        </div>
      )}
    </div>
  );
}
