import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

// Initialize Gemini Client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Gemini Robot Copilot endpoint for reinforcement learning, SpotMicro kinematics, and Pi 4 tuning
app.post('/api/gemini/robot-assist', async (req, res) => {
  try {
    const { prompt, context } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const systemInstruction = `You are the Lead Robotics Engineer and Reinforcement Learning Scientist for the SpotMicroAI 12-DOF Quadruped Robot project.
The robot is based on the open-source SpotMicro design (inspired by Boston Dynamics Spot) running on a Raspberry Pi 4 Model B (2018), 12x MG996R/DS3218 high-torque digital servos driven by a PCA9685 16-channel I2C PWM driver, an MPU6050 6-DOF IMU, and an HC-SR04 ultrasonic distance sensor.

Your expertise includes:
1. PyBullet and Gazebo 3D simulation setup, URDF joint tree configuration, physics engine damping, friction cones, and contact restitution.
2. Reinforcement Learning (PPO, SAC, DDPG) for quadruped locomotion: reward function shaping (forward speed, stability, foot slip penalty, energy cost, pitch/roll upright penalties), action/observation space design, and domain randomization for Sim-to-Real transfer.
3. Raspberry Pi 4 Model B (2018) hardware: 40-pin GPIO pinout, I2C bus 1 (/dev/i2c-1, pins 3 & 5), PCA9685 address 0x40 at 50Hz, MPU6050 address 0x68, HC-SR04 Trigger pin 23, Echo pin 24 with 3.3V voltage divider (1k/2k ohm), 2S/3S LiPo power distribution with 5V/6V 10A UBEC.
4. SpotMicro Kinematics: 3 DOF per leg (Hip roll, Upper leg pitch, Lower leg pitch). Exact link lengths: Body Length=280mm, Width=110mm, Hip L1=58mm, Upper leg L2=105mm, Lower leg L3=120mm. Inverse Kinematics trigonometry and foot coordinate frame transforms.
5. Python software stack: adafruit-circuitpython-servokit, smbus2, numpy, torch, stable-baselines3, and RPi.GPIO.

Provide clear, technically precise, production-grade answers, code snippets, or configuration suggestions tailored to SpotMicroAI.`;

    const userPrompt = context
      ? `Current SpotMicro Context:\n${JSON.stringify(context, null, 2)}\n\nUser Question:\n${prompt}`
      : prompt;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: userPrompt,
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    return res.json({ text: response.text });
  } catch (error: any) {
    console.error('Error calling Gemini API:', error);
    return res.status(500).json({
      error: error?.message || 'Failed to generate response from Gemini API',
    });
  }
});

// Vite Middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production static serving
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SpotMicroAI Simulation & Pi 4 Studio server running on port ${PORT}`);
  });
}

startServer();
