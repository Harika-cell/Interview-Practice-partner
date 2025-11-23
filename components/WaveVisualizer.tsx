import React from 'react';

interface WaveVisualizerProps {
  isListening: boolean;
  isSpeaking: boolean;
}

const WaveVisualizer: React.FC<WaveVisualizerProps> = ({ isListening, isSpeaking }) => {
  return (
    <div className="flex items-center justify-center h-24 gap-1.5">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className={`w-3 bg-gradient-to-t from-blue-500 to-purple-500 rounded-full transition-all duration-200 ${
            isSpeaking
              ? 'animate-wave h-16' 
              : isListening 
                ? 'h-8 animate-pulse' 
                : 'h-3 opacity-50'
          }`}
          style={{
            animationDelay: isSpeaking ? `${i * 0.1}s` : '0s',
            height: isSpeaking ? undefined : isListening ? '32px' : '12px'
          }}
        />
      ))}
    </div>
  );
};

export default WaveVisualizer;