import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-8 md:p-12 lg:p-24">
      <div className="text-center space-y-4 sm:space-y-6 md:space-y-8 max-w-4xl mx-auto px-4">
        <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-4 sm:mb-6 md:mb-8">
          Gaussian Splatting Viewer
        </h1>
        <p className="text-base sm:text-lg md:text-xl text-gray-400 mb-6 sm:mb-8 md:mb-12">
          Explore modelos 3D com tecnologia de Gaussian Splatting
        </p>
        <Link 
          href="/viewer"
          className="inline-block px-6 sm:px-8 md:px-12 py-3 sm:py-4 text-base sm:text-lg md:text-xl font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors duration-200 touch-manipulation"
        >
          Iniciar Experiência
        </Link>
      </div>
    </main>
  );
}
