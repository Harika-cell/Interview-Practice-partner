import { GoogleGenAI, Type } from "@google/genai";
import { InterviewSession, FeedbackData } from "../types";

// NOTE: Live API logic is handled in the component due to WebSocket/AudioContext state complexity.
// This service handles static generation (Feedback and Resume Analysis).

export const generateFeedback = async (session: InterviewSession): Promise<FeedbackData> => {
  if (!process.env.API_KEY) throw new Error("API Key missing");

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const transcript = session.messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role.toUpperCase()}: ${m.text}`)
    .join('\n');

  const prompt = `
    Analyze the following interview transcript for a ${session.config.level} ${session.config.customRole || session.config.role} position.
    
    Transcript:
    ${transcript}

    Provide detailed feedback in JSON format with:
    - A score out of 100.
    - A 2-sentence summary.
    - 3 key strengths (bullet points).
    - 3 areas for improvement (bullet points).
    - Assessment of technical accuracy.
    - Assessment of communication style.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                score: { type: Type.NUMBER },
                summary: { type: Type.STRING },
                strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
                improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
                technicalAccuracy: { type: Type.STRING },
                communicationStyle: { type: Type.STRING },
            }
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No feedback generated");
    
    return JSON.parse(text) as FeedbackData;
  } catch (e) {
    console.error("Feedback generation error:", e);
    return {
      score: 0,
      summary: "Unable to generate feedback at this time. Please check the interview length or API connection.",
      strengths: [],
      improvements: [],
      technicalAccuracy: "N/A",
      communicationStyle: "N/A"
    };
  }
};

export const extractResumeContext = async (base64Data: string, mimeType: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API Key missing");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: {
                parts: [
                    { inlineData: { mimeType, data: base64Data } },
                    { text: "Analyze this document. Extract the candidate's key skills, experience level, and a brief summary of their background. Output a concise paragraph to be used as context for an interviewer. Do not use markdown." }
                ]
            }
        });
        return response.text || "";
    } catch (e) {
        console.error("Resume extraction error:", e);
        throw new Error("Failed to analyze resume file.");
    }
};