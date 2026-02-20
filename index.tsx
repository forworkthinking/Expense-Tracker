
import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  limit, 
  Timestamp 
} from "firebase/firestore";

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

let db: any = null;
try {
  if (firebaseConfig.apiKey !== "YOUR_FIREBASE_API_KEY") {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  }
} catch (e) {
  console.warn("Firebase config not provided. Persistence will be mocked.");
}

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY });
const WEBHOOK_URL = "https://hook.eu1.make.com/d15nboistgbaqaf5yk9fgcd0092ofefb";

const App = () => {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, "expenses"), orderBy("createdAt", "desc"), limit(20));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setExpenses(docs);
      const sum = docs.reduce((acc, curr) => acc + (curr.amount || 0), 0);
      setTotal(sum);
    });
    return () => unsubscribe();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError(null);
      setSuccessMsg(null);
      // Automatically process with Gemini for immediate feedback in the UI
      processImage(file);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = (error) => reject(error);
    });
  };

  const processImage = async (file: File) => {
    setIsScanning(true);
    try {
      const base64Data = await fileToBase64(file);
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { inlineData: { data: base64Data, mimeType: file.type } },
              { text: "Extract receipt data. Return ONLY JSON with fields: merchant (string), amount (number, no currency symbols), date (string), currency (string)." }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              merchant: { type: Type.STRING },
              amount: { type: Type.NUMBER },
              date: { type: Type.STRING },
              currency: { type: Type.STRING }
            },
            required: ["merchant", "amount"]
          }
        }
      });

      const extractedData = JSON.parse(response.text || "{}");
      if (db) {
        await addDoc(collection(db, "expenses"), {
          ...extractedData,
          createdAt: Timestamp.now()
        });
      } else {
        const newExpense = {
          id: Date.now().toString(),
          ...extractedData,
          createdAt: new Date()
        };
        setExpenses(prev => [newExpense, ...prev]);
        setTotal(prev => prev + (extractedData.amount || 0));
      }
    } catch (err: any) {
      console.error(err);
      setError("AI Preview failed, but you can still submit the file.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedFile) return;
    
    setIsSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Webhook failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      setSuccessMsg("Uploaded sucessfully");
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to submit file to the server. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
            Expense Tracker
          </h1>
          <p className="text-slate-400">Intelligent receipt extraction & automation</p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="glass p-6 rounded-2xl">
          <p className="text-slate-400 text-sm font-medium uppercase tracking-wider mb-1">Total Monthly Expense</p>
          <p className="text-4xl font-bold text-white">
            ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="glass p-6 rounded-2xl">
          <p className="text-slate-400 text-sm font-medium uppercase tracking-wider mb-1">Items Processed</p>
          <p className="text-4xl font-bold text-blue-400">{expenses.length}</p>
        </div>

      </div>

      <section className="mb-12">
        <div 
          onClick={() => !isScanning && !isSubmitting && fileInputRef.current?.click()}
          className={`
            relative cursor-pointer group overflow-hidden
            border-2 border-dashed rounded-3xl p-10 
            transition-all duration-300 flex flex-col items-center justify-center
            ${selectedFile ? 'border-green-500 bg-green-500/5' : 'border-slate-700 hover:border-blue-400 hover:bg-white/5'}
            ${(isScanning || isSubmitting) ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          {(isScanning || isSubmitting) && <div className="absolute inset-0 shimmer opacity-50"></div>}
          
          <div className={`
            w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-transform
            ${selectedFile ? 'bg-green-600' : 'bg-slate-800 group-hover:scale-110'}
          `}>
            {selectedFile ? (
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </div>
          
          <h3 className="text-xl font-semibold mb-1">
            {selectedFile ? selectedFile.name : 'Choose Receipt Image'}
          </h3>
          <p className="text-slate-400 text-center">
            {selectedFile ? 'File ready to submit' : 'Click to capture or select a file'}
          </p>
          
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            className="hidden" 
          />
        </div>

        {selectedFile && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className={`
                px-8 py-3 rounded-xl font-bold text-lg shadow-lg transition-all
                ${isSubmitting 
                  ? 'bg-slate-700 text-slate-400 cursor-not-allowed' 
                  : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white transform hover:scale-105 active:scale-95'}
              `}
            >
              {isSubmitting ? 'Data Processing' : 'Upload Receipt'}
            </button>
          </div>
        )}

        {error && <p className="mt-4 text-center text-red-400 text-sm font-medium">{error}</p>}
        {successMsg && <p className="mt-4 text-center text-green-400 text-sm font-medium">{successMsg}</p>}
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4 px-1">Recent Activity</h2>
        <div className="space-y-3">
          {expenses.length === 0 ? (
            <div className="glass p-12 rounded-2xl text-center text-slate-500">
              No entries found.
            </div>
          ) : (
            expenses.map((expense) => (
              <div 
                key={expense.id} 
                className="glass p-4 rounded-2xl flex items-center justify-between hover:bg-white/10 transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-xl font-bold text-blue-400">
                    {expense.merchant?.charAt(0).toUpperCase() || '?'}
                  </div>
                  <div>
                    <h4 className="font-semibold text-white">{expense.merchant || 'Unknown Merchant'}</h4>
                    <p className="text-slate-400 text-sm">{expense.date || 'Recent'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-white">
                    ${(expense.amount || 0).toFixed(2)}
                  </p>
                  <p className="text-xs text-slate-500 uppercase tracking-widest">{expense.currency || 'USD'}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
