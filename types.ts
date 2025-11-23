export enum View {
  HOME = 'HOME',
  SETUP = 'SETUP',
  INTERVIEW = 'INTERVIEW',
  FEEDBACK = 'FEEDBACK',
  HISTORY = 'HISTORY',
  SETTINGS = 'SETTINGS'
}

export enum Role {
  SOFTWARE_ENGINEER = 'Software Engineer',
  PRODUCT_MANAGER = 'Product Manager',
  DATA_ANALYST = 'Data Analyst',
  SALES_REP = 'Sales Representative',
  CUSTOMER_SUPPORT = 'Customer Support Specialist',
  CUSTOM = 'Other / Custom'
}

export enum ExperienceLevel {
  JUNIOR = 'Junior',
  MID_LEVEL = 'Mid-Level',
  SENIOR = 'Senior'
}

export enum InteractionMode {
  VOICE = 'Voice Mode',
  TEXT = 'Text Mode'
}

export interface InterviewConfig {
  role: Role;
  customRole?: string;
  level: ExperienceLevel;
  mode: InteractionMode;
  resumeText?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'ai' | 'system';
  text: string;
  timestamp: number;
}

export interface InterviewSession {
  id: string;
  date: string;
  config: InterviewConfig;
  messages: Message[];
  feedback?: FeedbackData;
  durationSeconds: number;
}

export interface FeedbackData {
  score: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  technicalAccuracy: string;
  communicationStyle: string;
}

export interface AudioStreamConfig {
  sampleRate: number;
}