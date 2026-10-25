import React from 'react';
import { Activity, Radio, Compass, BatteryCharging, Gauge, ArrowUpRight } from 'lucide-react';
import { SensorData, RobotJointAngles } from '../types/robot';

interface SensorsHUDProps {
  sensors: SensorData;
  joints: RobotJointAngles;
}

export const SensorsHUD: React.FC<SensorsHUDProps> = ({ sensors, joints }) => {
  const { ultrasonicDistanceCm, imu, footContacts, footForces, batteryVoltage, servoCurrentAmps } = sensors;

  // Status color for ultrasonic proximity
  const getProximityColor = (dist: number) => {
    if (dist < 30) return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
    if (dist < 80) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-3 bg-neutral-900 border border-neutral-800 rounded-xl text-neutral-200">
      {/* 1. HC-SR04 Ultrasonic Distance Sensor */}
      <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800 flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
          <span className="flex items-center gap-1.5 font-medium">
            <Radio className="w-3.5 h-3.5 text-sky-400" />
            HC-SR04 Ultrasonic
          </span>
          <span className="text-[10px] font-mono text-neutral-500">TRIG:23 ECHO:24</span>
        </div>

        <div className="my-2 flex items-baseline justify-between">
          <div className="text-2xl font-bold font-mono tracking-tight text-neutral-100">
            {ultrasonicDistanceCm.toFixed(1)} <span className="text-xs text-neutral-400 font-sans">cm</span>
          </div>
          <span className={`text-[11px] font-mono px-2 py-0.5 rounded border ${getProximityColor(ultrasonicDistanceCm)}`}>
            {ultrasonicDistanceCm < 30 ? 'OBSTACLE' : ultrasonicDistanceCm < 80 ? 'CAUTION' : 'CLEAR'}
          </span>
        </div>

        {/* Proximity Progress Bar */}
        <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-150 ${
              ultrasonicDistanceCm < 30 ? 'bg-rose-500' : ultrasonicDistanceCm < 80 ? 'bg-amber-400' : 'bg-emerald-500'
            }`}
            style={{ width: `${Math.min(100, (ultrasonicDistanceCm / 200) * 100)}%` }}
          />
        </div>
      </div>

      {/* 2. MPU-6050 6-DOF IMU (Artificial Horizon & Angles) */}
      <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800 flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
          <span className="flex items-center gap-1.5 font-medium">
            <Compass className="w-3.5 h-3.5 text-amber-400" />
            MPU-6050 IMU (I2C 0x68)
          </span>
          <span className="text-[10px] font-mono text-neutral-500">50 Hz Filter</span>
        </div>

        {/* Pitch, Roll, Yaw Chips */}
        <div className="grid grid-cols-3 gap-1.5 my-1.5 font-mono text-center">
          <div className="p-1 rounded bg-neutral-900 border border-neutral-800">
            <div className="text-[10px] text-neutral-500">ROLL</div>
            <div className={`text-xs font-semibold ${Math.abs(imu.roll) > 15 ? 'text-amber-400' : 'text-neutral-200'}`}>
              {imu.roll > 0 ? `+${imu.roll}` : imu.roll}°
            </div>
          </div>
          <div className="p-1 rounded bg-neutral-900 border border-neutral-800">
            <div className="text-[10px] text-neutral-500">PITCH</div>
            <div className={`text-xs font-semibold ${Math.abs(imu.pitch) > 15 ? 'text-amber-400' : 'text-neutral-200'}`}>
              {imu.pitch > 0 ? `+${imu.pitch}` : imu.pitch}°
            </div>
          </div>
          <div className="p-1 rounded bg-neutral-900 border border-neutral-800">
            <div className="text-[10px] text-neutral-500">YAW</div>
            <div className="text-xs font-semibold text-neutral-200">
              {imu.yaw > 0 ? `+${imu.yaw}` : imu.yaw}°
            </div>
          </div>
        </div>

        {/* Accelerometer Magnitude */}
        <div className="text-[10px] text-neutral-400 font-mono flex justify-between">
          <span>Accel: {imu.accel.z.toFixed(1)} m/s²</span>
          <span>Gyro: {imu.gyro.x.toFixed(2)} rad/s</span>
        </div>
      </div>

      {/* 3. 4 Foot Contact Switches & Forces */}
      <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800 flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
          <span className="flex items-center gap-1.5 font-medium">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            Foot Ground Contacts
          </span>
          <span className="text-[10px] font-mono text-neutral-500">Reaction Force</span>
        </div>

        {/* 4 Paw Diagram */}
        <div className="grid grid-cols-2 gap-1.5 my-1.5">
          {(['FL', 'FR', 'RL', 'RR'] as const).map((leg) => {
            const isContact = footContacts[leg];
            const force = footForces[leg];
            return (
              <div
                key={leg}
                className={`p-1.5 rounded flex items-center justify-between font-mono text-xs border ${
                  isContact
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-500'
                }`}
              >
                <span className="font-bold text-[11px]">{leg}</span>
                <span className="text-[11px]">{isContact ? `${force.toFixed(1)}N` : 'SWING'}</span>
              </div>
            );
          })}
        </div>

        <div className="text-[10px] text-neutral-500 font-mono text-center">
          Robot Mass: 2.6 kg (~25.5 N total)
        </div>
      </div>

      {/* 4. Power, Battery & PCA9685 Current */}
      <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800 flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
          <span className="flex items-center gap-1.5 font-medium">
            <BatteryCharging className="w-3.5 h-3.5 text-amber-400" />
            Power & UBEC Rail
          </span>
          <span className="text-[10px] font-mono text-neutral-500">2S LiPo / 10A UBEC</span>
        </div>

        <div className="my-2 flex items-baseline justify-between font-mono">
          <div>
            <div className="text-xl font-bold text-amber-400 tracking-tight">
              {batteryVoltage.toFixed(2)} <span className="text-xs text-neutral-400 font-sans">V</span>
            </div>
            <div className="text-[10px] text-neutral-500">Nominal 7.4V (8.4V max)</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-sky-400">
              {servoCurrentAmps.toFixed(2)} <span className="text-xs text-neutral-400 font-sans">A</span>
            </div>
            <div className="text-[10px] text-neutral-500">12x Servo Load</div>
          </div>
        </div>

        {/* Safe status indicator */}
        <div className="flex items-center justify-between text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
          <span>Logic: 3.3V Pi / 5V PCA9685</span>
          <span className="font-mono">HEALTHY</span>
        </div>
      </div>
    </div>
  );
};
