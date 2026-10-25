import React, { useState } from 'react';
import { Cpu, Terminal, Copy, Check, Download, Zap, AlertTriangle, ShieldCheck, HelpCircle } from 'lucide-react';

export const PI_ROBOT_CONTROLLER_CODE = `#!/usr/bin/env python3
"""
SpotMicroAI Hardware Controller for Raspberry Pi 4 Model B (2018)
Controls 12x MG996R/DS3218 servos via PCA9685 I2C (0x40),
Reads MPU-6050 6-DOF IMU (0x68),
Reads HC-SR04 Ultrasonic Distance Sensor (GPIO 23/24).
"""

import time
import math
import sys
import numpy as np
import RPi.GPIO as GPIO
from adafruit_servokit import ServoKit
import smbus2

# --- PINOUT & HARDWARE CONFIGURATION ---
I2C_BUS = 1
PCA9685_ADDRESS = 0x40
MPU6050_ADDRESS = 0x68
TRIG_PIN = 23      # GPIO 23 (Physical Pin 16)
ECHO_PIN = 24      # GPIO 24 (Physical Pin 18 via 1k/2k ohm divider)

# Channel mapping on PCA9685 (0 to 15)
# Leg: [Hip, Shoulder, Knee]
SERVO_CHANNELS = {
    'FL': [0, 1, 2],    # Front Left
    'FR': [4, 5, 6],    # Front Right
    'RL': [8, 9, 10],   # Rear Left
    'RR': [12, 13, 14], # Rear Right
}

# Software trim offsets in degrees determined via servo_calibration.py
TRIM_OFFSETS = {
    'FL': [0.0, 2.5, -1.0],
    'FR': [0.0, -3.0, 1.5],
    'RL': [0.0, 1.0, 0.0],
    'RR': [0.0, -1.5, 2.0],
}

# SpotMicro Kinematics Parameters (in mm)
L1 = 58.5   # Hip lateral offset
L2 = 105.0  # Femur
L3 = 120.0  # Tibia

class SpotMicroPiController:
    def __init__(self):
        print("[*] Initializing Raspberry Pi 4 SpotMicro Controller...")
        
        # 1. Initialize PCA9685 16-Channel Servo Kit at 50Hz
        try:
            self.kit = ServoKit(channels=16, address=PCA9685_ADDRESS)
            for ch in range(16):
                # Set pulse width range for standard digital servos (500us to 2500us)
                self.kit.servo[ch].set_pulse_width_range(500, 2500)
            print("[+] PCA9685 PWM Driver connected at 0x40 (50Hz)")
        except Exception as e:
            print(f"[!] Warning: PCA9685 not detected on I2C bus: {e}")
            self.kit = None

        # 2. Initialize MPU-6050 IMU
        try:
            self.bus = smbus2.SMBus(I2C_BUS)
            # Wake up MPU-6050 (write 0 to PWR_MGMT_1 register 0x6B)
            self.bus.write_byte_data(MPU6050_ADDRESS, 0x6B, 0)
            print("[+] MPU-6050 6-DOF IMU initialized at 0x68")
        except Exception as e:
            print(f"[!] Warning: MPU-6050 not detected: {e}")
            self.bus = None

        # 3. Initialize HC-SR04 Ultrasonic GPIO
        GPIO.setmode(GPIO.BCM)
        GPIO.setwarnings(False)
        GPIO.setup(TRIG_PIN, GPIO.OUT)
        GPIO.setup(ECHO_PIN, GPIO.IN)
        GPIO.output(TRIG_PIN, False)
        time.sleep(0.1)
        print("[+] HC-SR04 Ultrasonic Sensor initialized (TRIG: 23, ECHO: 24)")

    def read_ultrasonic_distance_cm(self):
        """Reads HC-SR04 distance with timeout protection"""
        try:
            # Send 10us trigger pulse
            GPIO.output(TRIG_PIN, True)
            time.sleep(0.00001)
            GPIO.output(TRIG_PIN, False)

            start_time = time.time()
            timeout = start_time + 0.04  # 40ms timeout

            pulse_start = time.time()
            while GPIO.input(ECHO_PIN) == 0:
                pulse_start = time.time()
                if pulse_start > timeout:
                    return 400.0

            pulse_end = time.time()
            while GPIO.input(ECHO_PIN) == 1:
                pulse_end = time.time()
                if pulse_end > timeout:
                    return 400.0

            duration = pulse_end - pulse_start
            distance = (duration * 34300) / 2  # speed of sound in air (343 m/s)
            return round(min(400.0, max(2.0, distance)), 1)
        except Exception:
            return 400.0

    def read_imu_angles(self):
        """Reads accelerometer raw registers and computes Pitch & Roll"""
        if not self.bus:
            return 0.0, 0.0
        try:
            # Read 6 bytes of accel data starting at 0x3B
            data = self.bus.read_i2c_block_data(MPU6050_ADDRESS, 0x3B, 6)
            ax = (data[0] << 8 | data[1])
            ay = (data[2] << 8 | data[3])
            az = (data[4] << 8 | data[5])
            if ax > 32767: ax -= 65536
            if ay > 32767: ay -= 65536
            if az > 32767: az -= 65536

            # Compute pitch and roll in degrees
            roll = math.atan2(ay, az) * 180.0 / math.pi
            pitch = math.atan2(-ax, math.sqrt(ay**2 + az**2)) * 180.0 / math.pi
            return round(roll, 1), round(pitch, 1)
        except Exception:
            return 0.0, 0.0

    def set_leg_angles(self, leg, hip_deg, shoulder_deg, knee_deg):
        """Maps joint angles in degrees to 0-180 degree servo positions"""
        if not self.kit:
            return

        channels = SERVO_CHANNELS[leg]
        trims = TRIM_OFFSETS[leg]

        # Centering: 90 degrees is neutral mechanical center
        # Clamp between 0 and 180 for standard servo range
        servo_hip = max(0, min(180, 90 + hip_deg + trims[0]))
        servo_shoulder = max(0, min(180, 90 + shoulder_deg + trims[1]))
        servo_knee = max(0, min(180, 90 + (knee_deg + 90) + trims[2]))

        self.kit.servo[channels[0]].angle = servo_hip
        self.kit.servo[channels[1]].angle = servo_shoulder
        self.kit.servo[channels[2]].angle = servo_knee

    def stand_neutral(self):
        """Positions robot dog in stable standing stance"""
        for leg in ['FL', 'FR', 'RL', 'RR']:
            self.set_leg_angles(leg, 0, 45, -90)

    def run_loop(self):
        """Main 50Hz control loop"""
        print("[+] SpotMicro standing neutral. Press Ctrl+C to stop.")
        self.stand_neutral()
        time.sleep(1.0)

        step = 0
        try:
            while True:
                # 1. Read Sensors
                dist = self.read_ultrasonic_distance_cm()
                roll, pitch = self.read_imu_angles()

                # 2. Obstacle Detection Reaction
                if dist < 25.0:
                    print(f"[!] Obstacle detected at {dist}cm! Stopping and backing up...")
                    # Back up slightly
                    for leg in ['FL', 'FR', 'RL', 'RR']:
                        self.set_leg_angles(leg, 0, 30, -75)
                    time.sleep(0.5)
                    continue

                # 3. Trot Gait oscillation (50Hz loop)
                t = step * 0.12
                # Diagonal pairs swing / stance
                fl_shoulder = 45 + math.sin(t) * 20
                fl_knee = -90 - math.sin(t) * 25
                rr_shoulder = 45 + math.sin(t) * 20
                rr_knee = -90 - math.sin(t) * 25

                fr_shoulder = 45 - math.sin(t) * 20
                fr_knee = -90 + math.sin(t) * 25
                rl_shoulder = 45 - math.sin(t) * 20
                rl_knee = -90 + math.sin(t) * 25

                self.set_leg_angles('FL', 0, fl_shoulder, fl_knee)
                self.set_leg_angles('FR', 0, fr_shoulder, fr_knee)
                self.set_leg_angles('RL', 0, rl_shoulder, rl_knee)
                self.set_leg_angles('RR', 0, rr_shoulder, rr_knee)

                step += 1
                time.sleep(0.02)  # 50 Hz cycle

        except KeyboardInterrupt:
            print("\n[*] Safely shutting down servos...")
            self.stand_neutral()
            time.sleep(0.5)
            GPIO.cleanup()
            print("[+] Shutdown complete.")

if __name__ == '__main__':
    bot = SpotMicroPiController()
    bot.run_loop()
`;

export const PI_SERVO_CALIBRATION_CODE = `#!/usr/bin/env python3
"""
SpotMicroAI Interactive Servo Calibration Tool
Use this to mechanically align each horn at 90 degrees neutral and record trim offsets.
"""

from adafruit_servokit import ServoKit
import time
import json
import os

PCA9685_ADDRESS = 0x40
kit = ServoKit(channels=16, address=PCA9685_ADDRESS)

# Configure pulse widths (500us - 2500us)
for ch in range(16):
    kit.servo[ch].set_pulse_width_range(500, 2500)

print("=========================================================")
print("      SpotMicroAI Servo 90° Neutral Calibration Tool     ")
print("=========================================================")
print("1. Power on your 5V/6V UBEC battery supply to the PCA9685.")
print("2. Mount each servo horn as close to 90 degrees as possible.")
print("3. Enter trim offsets in degrees (-15 to +15) to level limbs.")

calibration = {}
channels = {
    'FL_Hip': 0, 'FL_Shoulder': 1, 'FL_Knee': 2,
    'FR_Hip': 4, 'FR_Shoulder': 5, 'FR_Knee': 6,
    'RL_Hip': 8, 'RL_Shoulder': 9, 'RL_Knee': 10,
    'RR_Hip': 12, 'RR_Shoulder': 13, 'RR_Knee': 14,
}

# Center all servos first to prevent binding
print("\\n[*] Centering all 12 servos to 90 degrees...")
for name, ch in channels.items():
    kit.servo[ch].angle = 90
    time.sleep(0.05)

for name, ch in channels.items():
    trim = 0.0
    while True:
        kit.servo[ch].angle = max(0, min(180, 90 + trim))
        print(f"\\nJoint: {name} (PCA9685 Ch {ch}) -> Current Angle: {90 + trim}°")
        cmd = input("Adjust trim (+1, -1, +5, -5) or press ENTER to confirm: ").strip()
        if cmd == "":
            calibration[name] = trim
            break
        try:
            trim += float(cmd)
        except ValueError:
            print("Invalid input! Type a number like +2 or -2.")

with open("servo_calibration_config.json", "w") as f:
    json.dump(calibration, f, indent=4)

print("\\n[+] Calibration saved to servo_calibration_config.json!")
`;

export const PI_DEPLOY_BASH_CODE = `#!/bin/bash
# One-Click Setup Script for SpotMicroAI on Raspberry Pi 4 Model B (2018)
# Supports Raspberry Pi OS (Bullseye & Bookworm)

set -e

echo "========================================================="
echo "   SpotMicroAI Raspberry Pi 4 Model B Installation       "
echo "========================================================="

echo "[*] Updating apt package lists..."
sudo apt update

echo "[*] Installing required system dependencies & I2C tools..."
sudo apt install -y python3-pip python3-smbus i2c-tools python3-rpi.gpio git

echo "[*] Enabling I2C hardware interface in /boot/config.txt..."
sudo raspi-config nonint do_i2c 0

echo "[*] Installing Python libraries (Adafruit ServoKit, smbus2, numpy)..."
pip3 install --upgrade pip
pip3 install adafruit-circuitpython-servokit smbus2 numpy

echo "[*] Testing I2C bus detection (PCA9685 at 0x40, MPU6050 at 0x68)..."
sudo i2cdetect -y 1

echo "[*] Setting up systemd auto-start service (optional)..."
cat << 'EOF' | sudo tee /etc/systemd/system/spotmicro.service
[Unit]
Description=SpotMicroAI Quadruped Robot Daemon
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/spotmicro
ExecStart=/usr/bin/python3 /home/pi/spotmicro/robot_controller.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload

echo "========================================================="
echo "[+] SpotMicroAI Raspberry Pi 4 Setup Complete!"
echo "    1. Run calibration: python3 servo_calibration.py"
echo "    2. Run robot:       python3 robot_controller.py"
echo "    3. Auto-start:      sudo systemctl enable spotmicro"
echo "========================================================="
`;

export const PiDeploymentHub: React.FC = () => {
  const [activeCodeTab, setActiveCodeTab] = useState<'controller' | 'calibration' | 'bash'>('controller');
  const [copied, setCopied] = useState(false);

  const getCode = () => {
    switch (activeCodeTab) {
      case 'controller':
        return PI_ROBOT_CONTROLLER_CODE;
      case 'calibration':
        return PI_SERVO_CALIBRATION_CODE;
      case 'bash':
        return PI_DEPLOY_BASH_CODE;
    }
  };

  const getFilename = () => {
    switch (activeCodeTab) {
      case 'controller':
        return 'robot_controller.py';
      case 'calibration':
        return 'servo_calibration.py';
      case 'bash':
        return 'deploy_rpi4.sh';
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getCode());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const element = document.createElement('a');
    const file = new Blob([getCode()], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = getFilename();
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between px-4 py-3 bg-neutral-950 border-b border-neutral-800 gap-2">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-emerald-400" />
          <span className="text-sm font-semibold tracking-wide text-neutral-100">
            Raspberry Pi 4 Model B (2018) Hardware & Deployment Hub
          </span>
          <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
            40-Pin GPIO Ready
          </span>
        </div>

        {/* Script Selection Tabs */}
        <div className="flex items-center bg-neutral-900 p-0.5 rounded-lg border border-neutral-800">
          <button
            onClick={() => setActiveCodeTab('controller')}
            className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors ${
              activeCodeTab === 'controller'
                ? 'bg-neutral-800 text-emerald-300 font-medium shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            robot_controller.py
          </button>
          <button
            onClick={() => setActiveCodeTab('calibration')}
            className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors ${
              activeCodeTab === 'calibration'
                ? 'bg-neutral-800 text-emerald-300 font-medium shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            servo_calibration.py
          </button>
          <button
            onClick={() => setActiveCodeTab('bash')}
            className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors ${
              activeCodeTab === 'bash'
                ? 'bg-neutral-800 text-emerald-300 font-medium shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            deploy_rpi4.sh
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg border border-neutral-700 transition"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-500 hover:bg-emerald-400 text-neutral-950 rounded-lg font-semibold shadow-md transition"
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </button>
        </div>
      </div>

      {/* Hardware Safety Callout & Wiring Quick Card */}
      <div className="p-4 bg-neutral-950/80 border-b border-neutral-800 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        {/* Warning 1: Power */}
        <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-neutral-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-amber-300">Dedicated Servo Power</div>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              NEVER power 12 servos from the Pi 5V pin! Use an external 2S/3S LiPo battery through a 5V/6V 10A UBEC wired directly to the PCA9685 screw terminal.
            </p>
          </div>
        </div>

        {/* Warning 2: Ultrasonic Voltage Divider */}
        <div className="p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-neutral-300 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-sky-300">HC-SR04 3.3V Logic Safe</div>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              The HC-SR04 ECHO pin outputs 5V. Wire a voltage divider (1kΩ series + 2kΩ to GND) before GPIO 24 to protect the Pi 4 SoC.
            </p>
          </div>
        </div>

        {/* Warning 3: Common Ground */}
        <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-neutral-300 flex items-start gap-2">
          <Zap className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-emerald-300">Common Ground (GND)</div>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              Connect Raspberry Pi GND (Pin 6/9), PCA9685 GND, and battery ground together to eliminate servo jitter and I2C bus errors.
            </p>
          </div>
        </div>
      </div>

      {/* Code Viewer */}
      <div className="flex-1 overflow-auto p-4 bg-neutral-950 font-mono text-xs leading-relaxed text-neutral-300">
        <pre className="whitespace-pre">{getCode()}</pre>
      </div>
    </div>
  );
};
