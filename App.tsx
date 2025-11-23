import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, LiveServerMessage, Modality, Chat } from '@google/genai';
import { View, Role, ExperienceLevel, InteractionMode, InterviewConfig, InterviewSession, Message, FeedbackData } from './types';
import { HomeIcon, MicIcon, HistoryIcon, SettingsIcon, SendIcon, StopIcon, UploadIcon, FileIcon, CheckCircleIcon, TrashIcon } from './components/Icons';
import WaveVisualizer from './components/WaveVisualizer';
import { base64ToUint8Array, arrayBufferToBase64, decodeAudioData, float32ToInt16PCM } from './utils/audio';
import { generateFeedback, extractResumeContext } from './services/interviewService';

// --- Sub Components ---

const Sidebar = ({ currentView, onViewChange }: { currentView: View, onViewChange: (v: View) => void }) => (
  <div className="w-64 bg-gray-950 border-r border-gray-800 flex flex-col h-screen sticky top-0 flex-shrink-0 z-20 hidden md:flex">
    <div className="p-6 flex items-center gap-3">
      <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center shadow-lg shadow-purple-900/50">
        <MicIcon className="text-white w-5 h-5" />
      </div>
      <h1 className="font-bold text-lg text-white tracking-tight">InterviewPro</h1>
    </div>
    
    <nav className="flex-1 px-4 space-y-2">
      <button 
        onClick={() => onViewChange(View.HOME)}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${currentView === View.HOME ? 'bg-gray-800 text-purple-400 shadow-inner' : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'}`}
      >
        <HomeIcon className="w-5 h-5" />
        <span className="font-medium">Home</span>
      </button>
      <button 
        onClick={() => onViewChange(View.SETUP)}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${currentView === View.SETUP || currentView === View.INTERVIEW ? 'bg-gray-800 text-purple-400 shadow-inner' : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'}`}
      >
        <MicIcon className="w-5 h-5" />
        <span className="font-medium">Practice</span>
      </button>
      <button 
        onClick={() => onViewChange(View.HISTORY)}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${currentView === View.HISTORY ? 'bg-gray-800 text-purple-400 shadow-inner' : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'}`}
      >
        <HistoryIcon className="w-5 h-5" />
        <span className="font-medium">History</span>
      </button>
    </nav>

    <div className="p-4 border-t border-gray-800">
      <button 
        onClick={() => onViewChange(View.SETTINGS)}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${currentView === View.SETTINGS ? 'bg-gray-800 text-purple-400 shadow-inner' : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'}`}
      >
        <SettingsIcon className="w-5 h-5" />
        <span className="font-medium">Settings</span>
      </button>
    </div>
  </div>
);

// --- Main App Component ---

const App = () => {
  const [currentView, setCurrentView] = useState<View>(View.HOME);
  const [config, setConfig] = useState<InterviewConfig>({
    role: Role.SOFTWARE_ENGINEER,
    customRole: "",
    level: ExperienceLevel.MID_LEVEL,
    mode: InteractionMode.VOICE,
    resumeText: ""
  });
  const [history, setHistory] = useState<InterviewSession[]>([]);
  const [currentSession, setCurrentSession] = useState<InterviewSession | null>(null);

  // Resume Upload State
  const [isProcessingResume, setIsProcessingResume] = useState(false);
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [resumeAnalysisResult, setResumeAnalysisResult] = useState<string | null>(null);

  // Audio & Gemini Live State
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");

  // Refs for audio management
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  
  // Ref for Text Mode Chat
  const chatSessionRef = useRef<Chat | null>(null);

  // Helper to add message
  const updateLastMessage = (text: string, role: 'user' | 'ai') => {
    setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === role) {
            return [...prev.slice(0, -1), { ...last, text: last.text + text }];
        } else {
            return [...prev, { id: Date.now().toString(), role, text, timestamp: Date.now() }];
        }
    });
  };

  const appendMessage = (text: string, role: 'user' | 'ai' | 'system') => {
    setMessages(prev => [...prev, { id: Date.now().toString(), role, text, timestamp: Date.now() }]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        alert("File too large. Max 5MB.");
        return;
    }

    setIsProcessingResume(true);
    setResumeFileName(file.name);
    setError(null);
    setResumeAnalysisResult(null);

    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const base64Str = (reader.result as string).split(',')[1];
            // Ensure mimeType is valid
            const mimeType = file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain');
            
            const text = await extractResumeContext(base64Str, mimeType);
            
            setConfig(prev => ({ ...prev, resumeText: text }));
            // Show a preview of what AI found
            setResumeAnalysisResult(text);
        } catch (err) {
            console.error(err);
            setError("Failed to analyze resume. Please try a different file.");
            setResumeFileName(null);
        } finally {
            setIsProcessingResume(false);
        }
    };
    reader.readAsDataURL(file);
  };

  const clearResume = () => {
    setConfig(prev => ({ ...prev, resumeText: "" }));
    setResumeFileName(null);
    setResumeAnalysisResult(null);
  };

  const getSystemInstruction = () => {
    return `You are an expert technical interviewer conducting a ${config.mode} interview for a ${config.level} ${config.role === Role.CUSTOM ? config.customRole : config.role} position. 
    ${config.resumeText ? `CONTEXT FROM CANDIDATE RESUME: ${config.resumeText}` : ''}
    
    CRITICAL INSTRUCTION - LANGUAGE ENFORCEMENT:
    - THIS INTERVIEW MUST BE CONDUCTED ENTIRELY IN ENGLISH.
    - DO NOT SWITCH LANGUAGES.
    - If the user speaks in another language, politely ask them to repeat in English.
    - Treat all input as if the user is attempting to speak English.
    
    Your goal is to assess the candidate's skills, cultural fit, and problem-solving abilities based on their experience level and the provided resume context (if any).
    Start by introducing yourself briefly and asking the first question.
    Keep questions concise. 
    Wait for the user to answer before asking the next question.
    If the user is confused, provide a small hint.
    Be professional but encouraging.`;
  };

  const startInterview = async () => {
    setError(null);
    setCurrentView(View.INTERVIEW);
    setMessages([]);
    
    if (config.mode === InteractionMode.TEXT) {
        await initializeTextChat();
    } else {
        await initializeGeminiLive();
    }
  };

  // --- TEXT MODE LOGIC ---
  const initializeTextChat = async () => {
     if (!process.env.API_KEY) {
         setError("API Key missing");
         return;
     }
     
     const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
     const chat = ai.chats.create({
         model: 'gemini-2.5-flash',
         config: {
             systemInstruction: getSystemInstruction()
         }
     });
     
     chatSessionRef.current = chat;
     setIsConnected(true);
     setIsRecording(false);
     
     // Start conversation
     try {
         const response = await chat.sendMessage({ message: "Start the interview. Introduce yourself and ask the first question." });
         appendMessage(response.text, 'ai');
     } catch (e: any) {
         setError(e.message);
     }
  };

  // --- VOICE MODE LOGIC ---
  const initializeGeminiLive = async () => {
    if (!process.env.API_KEY) throw new Error("API Key is missing");

    setMessages([{ id: 'init', role: 'system', text: 'Connecting to Live Voice Server...', timestamp: Date.now() }]);

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Setup Audio Contexts
    inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    outputNodeRef.current = audioContextRef.current.createGain();
    outputNodeRef.current.connect(audioContextRef.current.destination);

    // Get Mic Stream
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const configObj: any = {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
      },
      systemInstruction: { parts: [{ text: getSystemInstruction() }] }, 
      inputAudioTranscription: {}, // Keep empty to avoid connection errors with current model
      outputAudioTranscription: {}, 
    };

    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      config: configObj,
      callbacks: {
        onopen: () => {
          console.log("Session Opened");
          setIsConnected(true);
          setIsRecording(true);
          setupAudioInput(stream);
          setMessages([{ id: 'ready', role: 'system', text: 'Connected. AI is listening.', timestamp: Date.now() }]);
        },
        onmessage: async (msg: LiveServerMessage) => {
           handleLiveMessage(msg);
        },
        onclose: () => {
          console.log("Session Closed");
          setIsConnected(false);
          setIsRecording(false);
        },
        onerror: (err) => {
          console.error("Session Error", err);
          setError("Connection Error: " + (err instanceof Error ? err.message : String(err)));
          setIsConnected(false);
        }
      }
    });
    
    sessionPromiseRef.current = sessionPromise;
  };

  const setupAudioInput = (stream: MediaStream) => {
    if (!inputContextRef.current || !sessionPromiseRef.current) return;
    
    const source = inputContextRef.current.createMediaStreamSource(stream);
    sourceRef.current = source;
    
    // Use ScriptProcessor for raw PCM access
    const processor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const pcmData = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      const uint8 = new Uint8Array(pcmData.buffer);
      const base64 = arrayBufferToBase64(uint8.buffer);
      
      sessionPromiseRef.current?.then(session => {
        session.sendRealtimeInput({
          media: {
            mimeType: 'audio/pcm;rate=16000',
            data: base64
          }
        });
      });
    };

    source.connect(processor);
    processor.connect(inputContextRef.current.destination);
  };

  const handleLiveMessage = async (message: LiveServerMessage) => {
    // Handle Text Transcription (User)
    if (message.serverContent?.inputTranscription) {
        const text = message.serverContent.inputTranscription.text;
        if (text) updateLastMessage(text, 'user');
    }

    // Handle Text Transcription (Model)
    if (message.serverContent?.outputTranscription) {
        const text = message.serverContent.outputTranscription.text;
        if (text) updateLastMessage(text, 'ai');
    }
    
    // Handle Audio Output
    const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData && audioContextRef.current) {
      setIsAiSpeaking(true);
      const ctx = audioContextRef.current;
      nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
      
      try {
        const uint8 = base64ToUint8Array(audioData);
        const audioBuffer = await decodeAudioData(uint8, ctx, 24000);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(outputNodeRef.current!);
        source.onended = () => {
            activeSourcesRef.current.delete(source);
            if (activeSourcesRef.current.size === 0) setIsAiSpeaking(false);
        };
        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += audioBuffer.duration;
        activeSourcesRef.current.add(source);
      } catch (e) {
        console.error("Audio decode error", e);
      }
    }

    // Handle Interruptions
    if (message.serverContent?.interrupted) {
       activeSourcesRef.current.forEach(src => src.stop());
       activeSourcesRef.current.clear();
       nextStartTimeRef.current = 0;
       setIsAiSpeaking(false);
    }
  };

  const handleSendText = async () => {
      if (!inputText.trim()) return;
      const text = inputText;
      setInputText("");
      
      appendMessage(text, 'user');

      if (config.mode === InteractionMode.TEXT) {
          if (chatSessionRef.current) {
             try {
                const result = await chatSessionRef.current.sendMessage({ message: text });
                appendMessage(result.text, 'ai');
             } catch (e) {
                 console.error(e);
             }
          }
      } else {
          // Voice Mode - Send text to Live API as content part
          sessionPromiseRef.current?.then(session => {
              session.sendRealtimeInput({ content: { parts: [{ text: text }] } }); 
          });
      }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendText();
    }
  };

  const endInterview = async () => {
    // Cleanup Audio & Session
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (processorRef.current) processorRef.current.disconnect();
    if (sourceRef.current) sourceRef.current.disconnect();
    if (inputContextRef.current) inputContextRef.current.close();
    if (audioContextRef.current) audioContextRef.current.close();
    
    // Force wait a tick to ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 100));

    setIsConnected(false);
    setIsRecording(false);
    chatSessionRef.current = null;

    // Generate Feedback
    setCurrentView(View.FEEDBACK);
    
    const sessionData: InterviewSession = {
      id: Date.now().toString(),
      date: new Date().toLocaleString(),
      config: config,
      messages: messages,
      durationSeconds: 0,
    };

    setHistory(prev => [sessionData, ...prev]);
    setCurrentSession(sessionData);
  };

  const renderView = () => {
    switch (currentView) {
      case View.HOME:
        return (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center animate-fade-in max-w-7xl mx-auto">
            <div className="w-24 h-24 bg-gradient-to-r from-purple-600 to-blue-600 rounded-3xl flex items-center justify-center mb-8 shadow-2xl shadow-purple-900/50 transform hover:scale-110 transition-transform">
               <MicIcon className="w-12 h-12 text-white" />
            </div>
            <h1 className="text-5xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
              Master Your Next Interview
            </h1>
            <p className="text-xl text-gray-400 max-w-3xl mb-12 leading-relaxed">
              Practice with our realistic AI partner. Get real-time voice feedback, detailed analysis, and boost your confidence before the big day.
            </p>
            <button 
              onClick={() => setCurrentView(View.SETUP)}
              className="group relative px-8 py-4 bg-purple-600 hover:bg-purple-500 rounded-2xl font-bold text-lg transition-all duration-200 hover:scale-105 shadow-lg shadow-purple-900/30 cursor-pointer"
            >
              <div className="flex items-center gap-3">
                 <span>Start Practice Session</span>
                 <span className="group-hover:translate-x-1 transition-transform">→</span>
              </div>
            </button>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-20 w-full max-w-6xl">
                <div 
                  onClick={() => setCurrentView(View.SETUP)}
                  className="bg-gray-900 p-6 rounded-2xl border border-gray-800 hover:border-purple-500/50 transition-all cursor-pointer hover:bg-gray-800/50 hover:-translate-y-1"
                >
                    <div className="w-10 h-10 bg-purple-900/50 rounded-lg flex items-center justify-center mb-4 text-purple-400">
                        <SettingsIcon className="w-6 h-6"/>
                    </div>
                    <h3 className="font-bold text-white mb-2">Role Specific</h3>
                    <p className="text-sm text-gray-400">Tailored questions for Engineers, PMs, Sales, and more.</p>
                </div>
                <div 
                  onClick={() => { setConfig({...config, mode: InteractionMode.VOICE}); setCurrentView(View.SETUP); }}
                  className="bg-gray-900 p-6 rounded-2xl border border-gray-800 hover:border-purple-500/50 transition-all cursor-pointer hover:bg-gray-800/50 hover:-translate-y-1"
                >
                     <div className="w-10 h-10 bg-pink-900/50 rounded-lg flex items-center justify-center mb-4 text-pink-400">
                        <MicIcon className="w-6 h-6"/>
                    </div>
                    <h3 className="font-bold text-white mb-2">Voice Mode</h3>
                    <p className="text-sm text-gray-400">Ultra-low latency natural conversation powered by Gemini.</p>
                </div>
                <div 
                  onClick={() => setCurrentView(View.HISTORY)}
                  className="bg-gray-900 p-6 rounded-2xl border border-gray-800 hover:border-purple-500/50 transition-all cursor-pointer hover:bg-gray-800/50 hover:-translate-y-1"
                >
                     <div className="w-10 h-10 bg-blue-900/50 rounded-lg flex items-center justify-center mb-4 text-blue-400">
                        <HistoryIcon className="w-6 h-6"/>
                    </div>
                    <h3 className="font-bold text-white mb-2">Detailed Feedback</h3>
                    <p className="text-sm text-gray-400">Get actionable insights on your answers and communication style.</p>
                </div>
            </div>
          </div>
        );

      case View.SETUP:
        return (
          <div className="max-w-6xl mx-auto py-12 px-8 overflow-y-auto">
            <div className="flex items-center gap-3 mb-8">
              <div className="p-2 bg-gray-800 rounded-lg">
                <SettingsIcon className="w-6 h-6 text-purple-400" />
              </div>
              <h2 className="text-3xl font-bold">Setup Interview</h2>
            </div>

            <div className="space-y-10">
               {/* Resume Upload */}
               <div className="space-y-4">
                <label className="text-sm font-medium text-gray-400 uppercase tracking-wider">UPLOAD RESUME (Optional)</label>
                <div className={`relative border-2 border-dashed rounded-2xl p-8 transition-colors ${resumeFileName ? 'border-green-500/50 bg-green-500/5' : 'border-gray-700 bg-gray-900 hover:border-purple-500'}`}>
                    <input 
                        type="file" 
                        accept=".pdf,.txt,.doc,.docx"
                        onChange={handleFileUpload}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        disabled={isProcessingResume}
                    />
                    
                    {isProcessingResume ? (
                        <div className="flex flex-col items-center justify-center">
                            <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                            <p className="text-purple-400 font-medium">Analyzing resume...</p>
                        </div>
                    ) : resumeFileName ? (
                        <div className="flex flex-col gap-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-green-500/20 rounded-xl text-green-400">
                                        <FileIcon className="w-8 h-8" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-white">{resumeFileName}</p>
                                        <p className="text-green-400 text-sm flex items-center gap-1">
                                            <CheckCircleIcon className="w-4 h-4" /> Analyzed & Ready
                                        </p>
                                    </div>
                                </div>
                                <button onClick={(e) => { e.preventDefault(); clearResume(); }} className="p-2 hover:bg-red-500/20 text-gray-500 hover:text-red-400 rounded-lg z-20">
                                    <TrashIcon className="w-5 h-5" />
                                </button>
                            </div>
                            
                            {/* Analysis Preview */}
                            {resumeAnalysisResult && (
                                <div className="bg-green-900/20 border border-green-500/20 rounded-lg p-4 mt-2">
                                    <p className="text-xs text-green-400 font-bold uppercase mb-1">AI Extracted Context:</p>
                                    <p className="text-sm text-gray-300 italic line-clamp-3">"{resumeAnalysisResult}"</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center text-center">
                            <div className="p-4 bg-gray-800 rounded-full mb-4">
                                <UploadIcon className="w-8 h-8 text-gray-400" />
                            </div>
                            <p className="text-lg font-medium text-white mb-2">Click to upload Resume</p>
                            <p className="text-gray-400 text-sm">PDF, TXT, DOCX (Max 5MB)</p>
                            <p className="text-xs text-gray-500 mt-2">AI will extract key skills and background</p>
                        </div>
                    )}
                </div>
              </div>

              {/* Role Selection */}
              <div className="space-y-4">
                <label className="text-sm font-medium text-gray-400 uppercase tracking-wider">Target Role</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {Object.values(Role).map((r) => (
                    <button
                      key={r}
                      onClick={() => setConfig({ ...config, role: r })}
                      className={`p-5 rounded-xl text-left border transition-all ${config.role === r ? 'bg-purple-900/20 border-purple-500 text-white shadow-md shadow-purple-900/20' : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700'}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                {/* Custom Role Input */}
                {config.role === Role.CUSTOM && (
                     <div className="mt-4 animate-fade-in">
                        <label className="block text-xs text-gray-500 mb-2 uppercase">Custom Job Title</label>
                        <input 
                            type="text" 
                            value={config.customRole}
                            onChange={(e) => setConfig({...config, customRole: e.target.value})}
                            placeholder="e.g. Senior iOS Developer"
                            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:border-purple-500 outline-none"
                            autoFocus
                        />
                     </div>
                )}
              </div>

              {/* Experience Level */}
              <div className="space-y-4">
                <label className="text-sm font-medium text-gray-400 uppercase tracking-wider">Experience Level</label>
                <div className="flex gap-4 bg-gray-900 p-2 rounded-xl border border-gray-800">
                  {Object.values(ExperienceLevel).map((l) => (
                    <button
                      key={l}
                      onClick={() => setConfig({ ...config, level: l })}
                      className={`flex-1 py-3 rounded-lg text-sm font-medium transition-all ${config.level === l ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

               {/* Interaction Mode */}
               <div className="space-y-4">
                <label className="text-sm font-medium text-gray-400 uppercase tracking-wider">Interaction Mode</label>
                <div className="grid grid-cols-2 gap-6">
                    <button
                      onClick={() => setConfig({ ...config, mode: InteractionMode.VOICE })}
                      className={`p-6 rounded-2xl border text-left transition-all ${config.mode === InteractionMode.VOICE ? 'bg-gradient-to-br from-purple-900/40 to-pink-900/40 border-purple-500 shadow-lg shadow-purple-900/10' : 'bg-gray-900 border-gray-800 opacity-60'}`}
                    >
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-3 ${config.mode === InteractionMode.VOICE ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400'}`}>
                            <MicIcon className="w-5 h-5" />
                        </div>
                        <div className="font-bold mb-1">Voice Mode</div>
                        <div className="text-sm text-gray-400">Real-time conversation</div>
                    </button>
                    <button
                      onClick={() => setConfig({ ...config, mode: InteractionMode.TEXT })}
                      className={`p-6 rounded-2xl border text-left transition-all ${config.mode === InteractionMode.TEXT ? 'bg-gradient-to-br from-blue-900/40 to-cyan-900/40 border-blue-500 shadow-lg shadow-blue-900/10' : 'bg-gray-900 border-gray-800 opacity-60'}`}
                    >
                         <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-3 ${config.mode === InteractionMode.TEXT ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'}`}>
                            <div className="w-5 h-5 border-2 border-current rounded-sm" />
                        </div>
                        <div className="font-bold mb-1">Text Mode</div>
                        <div className="text-sm text-gray-400">Standard chat interface (No Audio)</div>
                    </button>
                </div>
              </div>

              <button
                onClick={startInterview}
                disabled={config.role === Role.CUSTOM && !config.customRole}
                className={`w-full py-5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold rounded-xl shadow-lg shadow-purple-900/40 transition-all hover:scale-[1.01] mt-6 text-lg cursor-pointer ${config.role === Role.CUSTOM && !config.customRole ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Start Interview Session
              </button>
            </div>
          </div>
        );

      case View.INTERVIEW:
        const isVoice = config.mode === InteractionMode.VOICE;

        return (
          <div className="flex flex-col h-full bg-[#0B0F19]">
            {/* Header */}
            <div className="px-8 py-4 border-b border-gray-800 flex justify-between items-center bg-gray-900/50 backdrop-blur-sm sticky top-0 z-10 flex-shrink-0">
              <div>
                <h2 className="font-bold text-xl flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></span>
                  {config.role === Role.CUSTOM ? config.customRole : config.role} Interview
                </h2>
                <p className="text-gray-400 text-sm">{config.level} • {config.mode}</p>
              </div>
              <button 
                onClick={endInterview}
                className="px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg font-medium transition-colors flex items-center gap-2 border border-red-500/20 cursor-pointer"
              >
                <StopIcon className="w-4 h-4" />
                End Interview
              </button>
            </div>

             {/* Chat Area (Expanded) */}
             <div className="flex-1 overflow-y-auto p-8 space-y-6 scroll-smooth w-full max-w-7xl mx-auto bg-gray-900/30 relative">
                 {error && (
                    <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-2 rounded-lg text-center mb-4">
                        {error}
                    </div>
                 )}
                 {messages.length === 0 && <p className="text-center text-gray-600 italic mt-10">Starting session...</p>}
                 {messages.map((msg) => (
                    <div key={msg.id} className={`flex w-full ${msg.role === 'ai' || msg.role === 'system' ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-[90%] md:max-w-[85%] p-5 rounded-2xl shadow-sm ${msg.role === 'ai' ? 'bg-gray-800 text-gray-100 rounded-tl-none border border-gray-700' : msg.role === 'system' ? 'bg-yellow-900/20 text-yellow-500 text-xs border border-yellow-800' : 'bg-purple-600 text-white rounded-tr-none'}`}>
                            <p className="text-base leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                        </div>
                    </div>
                ))}
                <div ref={(el) => el?.scrollIntoView({ behavior: 'smooth' })} />
            </div>

            {/* Voice Visuals (Moved to Bottom, Only in Voice Mode) */}
            {isVoice && (
                <div className="h-[180px] flex flex-col items-center justify-center p-4 flex-shrink-0 bg-[#0B0F19] border-t border-gray-800">
                    <div className="relative mb-4">
                        <div className={`w-16 h-16 rounded-full bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center shadow-2xl border-4 transition-all duration-300 ${isAiSpeaking ? 'border-purple-500 shadow-purple-500/50 scale-105' : 'border-gray-700'}`}>
                                <MicIcon className={`w-8 h-8 transition-colors duration-300 ${isAiSpeaking ? 'text-purple-400' : 'text-gray-600'}`} />
                        </div>
                        <div className={`absolute inset-0 rounded-full blur-xl bg-purple-600/30 -z-10 transition-opacity duration-300 ${isAiSpeaking ? 'opacity-100' : 'opacity-0'}`}></div>
                    </div>
                    <div className="h-8 mb-2">
                            <WaveVisualizer isListening={isRecording} isSpeaking={isAiSpeaking} />
                    </div>
                    <div className="text-center">
                        <p className="text-gray-400 text-sm font-medium">{isAiSpeaking ? 'AI is speaking...' : isRecording ? 'Listening...' : 'Connecting...'}</p>
                    </div>
                </div>
            )}

            {/* Input Area (Only Visible in Text Mode) */}
            {!isVoice && (
                <div className="p-4 border-t border-gray-800 bg-gray-900 sticky bottom-0">
                    <div className="max-w-4xl mx-auto relative flex gap-4">
                        <input 
                            type="text" 
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Type your answer..."
                            className="flex-1 bg-gray-800 border-none rounded-xl px-6 py-4 text-white placeholder-gray-500 focus:ring-2 focus:ring-purple-500 outline-none shadow-inner"
                        />
                        <button 
                            onClick={handleSendText}
                            disabled={!inputText.trim()}
                            className="bg-purple-600 hover:bg-purple-500 text-white p-4 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <SendIcon className="w-6 h-6" />
                        </button>
                    </div>
                </div>
            )}
          </div>
        );
      
      case View.FEEDBACK:
          return <FeedbackView session={currentSession} onRetake={() => setCurrentView(View.SETUP)} />;

      case View.HISTORY:
          return (
            <div className="p-8 max-w-6xl mx-auto h-full overflow-y-auto">
                <h2 className="text-3xl font-bold mb-8">Interview History</h2>
                {history.length === 0 ? (
                    <div className="text-center py-20 border border-dashed border-gray-800 rounded-2xl bg-gray-900/30">
                        <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                            <HistoryIcon className="w-8 h-8 text-gray-500" />
                        </div>
                        <p className="text-gray-400 mb-4">No interviews yet.</p>
                        <button onClick={() => setCurrentView(View.SETUP)} className="text-purple-400 hover:underline">Start your first session</button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {history.map((sess) => (
                            <div key={sess.id} className="bg-gray-900 p-6 rounded-xl border border-gray-800 hover:border-purple-500/30 transition-colors cursor-pointer group" onClick={() => { setCurrentSession(sess); setCurrentView(View.FEEDBACK); }}>
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h3 className="font-bold text-lg group-hover:text-purple-400 transition-colors">{sess.config.role === Role.CUSTOM ? sess.config.customRole : sess.config.role}</h3>
                                        <p className="text-gray-400 text-sm">{sess.date}</p>
                                    </div>
                                    <div className={`px-3 py-1 rounded-full text-xs font-bold ${sess.feedback ? 'bg-purple-900/30 text-purple-300' : 'bg-gray-800 text-gray-400'}`}>
                                        {sess.feedback?.score ? `${sess.feedback.score}/100` : 'Pending'}
                                    </div>
                                </div>
                                <div className="flex gap-4 text-sm text-gray-500">
                                    <span>{sess.config.level}</span>
                                    <span>•</span>
                                    <span>{sess.messages.filter(m => m.role !== 'system').length} turns</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
          );
      
      case View.SETTINGS:
        return (
            <div className="p-8 max-w-6xl mx-auto h-full overflow-y-auto">
                <h2 className="text-3xl font-bold mb-8 flex items-center gap-3">
                    <SettingsIcon className="w-8 h-8 text-purple-400" />
                    Settings
                </h2>
                
                <div className="space-y-6">
                    {/* Application Info */}
                    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
                         <h3 className="text-lg font-bold mb-6 flex items-center gap-2 text-blue-400">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
                            Application Info
                         </h3>
                         <div className="space-y-4">
                            <div className="flex justify-between items-center py-2 border-b border-gray-800">
                                <span className="text-gray-400">Version</span>
                                <span className="font-mono bg-gray-800 px-2 py-1 rounded text-sm">v1.1.0</span>
                            </div>
                             <div className="flex justify-between items-center py-2 border-b border-gray-800">
                                <span className="text-gray-400">AI Model</span>
                                <span className="text-white">Gemini 2.5 Flash</span>
                            </div>
                             <div className="flex justify-between items-center py-2">
                                <span className="text-gray-400">Voice Latency</span>
                                <span className="text-green-400">Low (Real-time)</span>
                            </div>
                         </div>
                    </div>

                    {/* Capabilities */}
                    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
                         <h3 className="text-lg font-bold mb-6 flex items-center gap-2 text-pink-400">
                             <div className="w-1.5 h-1.5 rounded-full bg-pink-400"></div>
                            Capabilities
                         </h3>
                         <div className="space-y-4">
                            <div className="bg-gray-800/50 p-4 rounded-xl flex items-center gap-4">
                                <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400">
                                    <MicIcon className="w-6 h-6" />
                                </div>
                                <div>
                                    <div className="font-bold text-white">Voice Interaction</div>
                                    <div className="text-sm text-gray-400">Real-time bidirectional audio streaming</div>
                                </div>
                            </div>
                            <div className="bg-gray-800/50 p-4 rounded-xl flex items-center gap-4">
                                <div className="p-2 bg-pink-500/20 rounded-lg text-pink-400">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                </div>
                                <div>
                                    <div className="font-bold text-white">Smart Transcriptions</div>
                                    <div className="text-sm text-gray-400">Live text-to-speech and speech-to-text</div>
                                </div>
                            </div>
                         </div>
                    </div>

                    {/* Data Management */}
                    <div className="bg-gray-900 rounded-2xl border border-red-900/30 p-6">
                         <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-red-400">
                             <div className="w-1.5 h-1.5 rounded-full bg-red-400"></div>
                            Data Management
                         </h3>
                         <p className="text-sm text-gray-400 mb-6">Clear all your local interview history. This includes feedback scores, transcripts, and session logs.</p>
                         <button 
                            onClick={() => {
                                if(confirm('Are you sure you want to delete all history?')) {
                                    setHistory([]);
                                }
                            }}
                            className="px-4 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-900/50 rounded-lg transition-colors text-sm font-medium"
                         >
                            Clear All History
                         </button>
                    </div>
                </div>
            </div>
        );

      default: 
        return <div className="p-10 text-center">Page not found</div>;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#0B0F19] text-white font-sans">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />
      <main className="flex-1 h-full overflow-y-auto relative">
        {renderView()}
      </main>
    </div>
  );
};

// --- Feedback View Component ---

const FeedbackView = ({ session, onRetake }: { session: InterviewSession | null, onRetake: () => void }) => {
    const [data, setData] = useState<FeedbackData | null>(session?.feedback || null);
    const [loading, setLoading] = useState(!session?.feedback);

    useEffect(() => {
        if (session && !session.feedback) {
            generateFeedback(session).then(res => {
                setData(res);
                if (session) session.feedback = res; 
                setLoading(false);
            });
        }
    }, [session]);

    if (!session) return <div>No session data</div>;

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full space-y-4">
                <div className="relative">
                    <div className="w-16 h-16 border-4 border-gray-800 rounded-full"></div>
                    <div className="w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin absolute top-0 left-0"></div>
                </div>
                <p className="text-gray-400 animate-pulse text-lg">Analyzing interview performance...</p>
                <p className="text-sm text-gray-600">Generating scoring, strengths, and improvements</p>
            </div>
        );
    }

    if (!data) return <div>Error loading feedback</div>;

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fade-in pb-20">
            <div className="flex justify-between items-center border-b border-gray-800 pb-6">
                <div>
                    <h2 className="text-3xl font-bold mb-2">Performance Review</h2>
                    <p className="text-gray-400">{session.config.role === Role.CUSTOM ? session.config.customRole : session.config.role} • {session.config.level}</p>
                </div>
                <div className="text-right">
                    <div className="text-sm text-gray-400 uppercase tracking-wider mb-1">Overall Score</div>
                    <div className="text-6xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400 drop-shadow-lg">
                        {data.score}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="col-span-3 bg-gray-900 p-8 rounded-2xl border border-gray-800 shadow-xl">
                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                        Summary
                    </h3>
                    <p className="text-gray-300 leading-relaxed text-lg">{data.summary}</p>
                </div>

                <div className="bg-gray-900 p-6 rounded-2xl border border-green-900/30 hover:border-green-500/30 transition-colors">
                    <h3 className="text-lg font-bold mb-4 text-green-400 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        Strengths
                    </h3>
                    <ul className="space-y-4">
                        {data.strengths.map((s, i) => (
                            <li key={i} className="flex gap-3 text-sm text-gray-300">
                                <div className="mt-1 min-w-[16px]">
                                    <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                </div>
                                <span className="leading-relaxed">{s}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="bg-gray-900 p-6 rounded-2xl border border-orange-900/30 hover:border-orange-500/30 transition-colors">
                    <h3 className="text-lg font-bold mb-4 text-orange-400 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                        Improvements
                    </h3>
                    <ul className="space-y-4">
                         {data.improvements.map((s, i) => (
                            <li key={i} className="flex gap-3 text-sm text-gray-300">
                                <div className="mt-1 min-w-[16px]">
                                    <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                </div>
                                <span className="leading-relaxed">{s}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800">
                     <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                        Detailed Analysis
                     </h3>
                     <div className="space-y-6">
                        <div>
                            <div className="text-xs text-gray-500 uppercase mb-2 tracking-wider">Technical Accuracy</div>
                            <p className="text-sm text-gray-300 leading-relaxed bg-gray-800/50 p-3 rounded-lg">{data.technicalAccuracy}</p>
                        </div>
                        <div>
                             <div className="text-xs text-gray-500 uppercase mb-2 tracking-wider">Communication Style</div>
                             <p className="text-sm text-gray-300 leading-relaxed bg-gray-800/50 p-3 rounded-lg">{data.communicationStyle}</p>
                        </div>
                     </div>
                </div>
            </div>

            <div className="flex justify-end pt-8 border-t border-gray-800">
                <button 
                    onClick={onRetake}
                    className="group flex items-center gap-2 px-8 py-4 bg-white text-gray-900 font-bold rounded-xl hover:bg-gray-200 transition-all hover:scale-105 shadow-lg shadow-white/10"
                >
                    <svg className="w-5 h-5 transition-transform group-hover:rotate-180 duration-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    Start New Session
                </button>
            </div>
        </div>
    );
}

export default App;