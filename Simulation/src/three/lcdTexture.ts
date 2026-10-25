import * as THREE from 'three';
import {
  LcdModuleConfig,
  NavigationConfigAndState,
  PosePreset,
  SensorTelemetry,
  ServoChannel,
} from '../types/simulator';

export function buildLcdLines(
  lcd: LcdModuleConfig,
  poseLabel: PosePreset,
  isRunning: boolean,
  channels: ServoChannel[],
  telemetry: SensorTelemetry,
  navigation?: NavigationConfigAndState
): string[] {
  if (lcd.screenPreset === 'custom') {
    return lcd.customText.split('\n').slice(0, 7);
  }

  if (
    navigation?.enabled &&
    (navigation.fsmState === 'PATH_BLOCKED' || navigation.fsmState === 'WAITING_FOR_CLEARANCE')
  ) {
    return [
      'PATH BLOCKED',
      'WAITING FOR CLEARANCE',
      `FWD: ${navigation.nearestForwardM.toFixed(2)}m`,
      `L/R: ${navigation.leftClearanceM.toFixed(2)}/${navigation.rightClearanceM.toFixed(2)}m`,
      `STATE: ${navigation.activityState}`,
      'Mode: SIMULATION',
    ];
  }

  if (lcd.screenPreset === 'servos') {
    return [
      'KUKUR PCA9685 [SIM]',
      `FL: ${channels[0].targetAngle.toFixed(0)} ${channels[1].targetAngle.toFixed(0)} ${channels[2].targetAngle.toFixed(0)} deg`,
      `FR: ${channels[3].targetAngle.toFixed(0)} ${channels[4].targetAngle.toFixed(0)} ${channels[5].targetAngle.toFixed(0)} deg`,
      `BL: ${channels[6].targetAngle.toFixed(0)} ${channels[7].targetAngle.toFixed(0)}* ${channels[8].targetAngle.toFixed(0)} deg`,
      `BR: ${channels[9].targetAngle.toFixed(0)} ${channels[10].targetAngle.toFixed(0)} ${channels[11].targetAngle.toFixed(0)} deg`,
      'HW: DISCONNECTED',
    ];
  }

  if (lcd.screenPreset === 'sensors') {
    return [
      'KUKUR TELEMETRY [SIM]',
      `ACC: ${telemetry.accel[0].toFixed(2)} ${telemetry.accel[1].toFixed(2)}g`,
      `GYR: ${telemetry.gyro[0].toFixed(1)} ${telemetry.gyro[1].toFixed(1)}d/s`,
      `SONAR: ${telemetry.ultrasonicCm.toFixed(1)} cm (VIRT)`,
      `NAV: ${navigation?.enabled ? navigation.fsmState : 'MANUAL'}`,
      `STATE: ${navigation?.enabled ? navigation.activityState : isRunning ? 'ACTIVE SIM' : 'HALTED'}`,
    ];
  }

  if (navigation?.enabled) {
    return [
      `KUKUR [${navigation.activityState}]`,
      `State: ${navigation.fsmState}`,
      `Fwd: ${navigation.nearestForwardM.toFixed(2)}m Safe:${navigation.safetyDistanceM.toFixed(2)}m`,
      `Turn: ${navigation.selectedTurnDirection}`,
      navigation.isLiftedOffFloor ? 'Ground: LIFTED (WAIT)' : 'IMU/Cam: SIMULATED',
      `Battery: SIMULATED (${telemetry.batteryVoltage.toFixed(1)}V)`,
    ];
  }

  return [
    'KUKUR',
    'Mode: SIMULATION',
    `Pose: ${poseLabel.toUpperCase()}`,
    'IMU: SIMULATED',
    'Camera: SIMULATED',
    `Battery: SIMULATED (${telemetry.batteryVoltage.toFixed(1)}V)`,
  ];
}

export function drawLcdCanvas(
  canvas: HTMLCanvasElement,
  lines: string[],
  lcd: LcdModuleConfig
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  const isBlockedAlert = lines[0] === 'PATH BLOCKED';

  const palette = isBlockedAlert
    ? {
        bgTop: '#450a0a',
        bgBot: '#290505',
        border: '#ef4444',
        text: '#fef2f2',
        sub: '#fca5a5',
        grid: 'rgba(239,68,68,0.12)',
      }
    : lcd.backlightColor === 'emerald'
    ? {
        bgTop: '#042f2e',
        bgBot: '#022c22',
        border: '#10b981',
        text: '#ecfdf5',
        sub: '#6ee7b7',
        grid: 'rgba(16,185,129,0.08)',
      }
    : lcd.backlightColor === 'amber'
    ? {
        bgTop: '#3b1d06',
        bgBot: '#271203',
        border: '#f59e0b',
        text: '#fffbeb',
        sub: '#fcd34d',
        grid: 'rgba(245,158,11,0.08)',
      }
    : {
        bgTop: '#082f49',
        bgBot: '#0c4a6e',
        border: '#38bdf8',
        text: '#f0f9ff',
        sub: '#7dd3fc',
        grid: 'rgba(56,189,248,0.1)',
      };

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  ctx.translate(w / 2, h / 2);
  ctx.rotate((lcd.orientation * Math.PI) / 180);

  const isPortrait = lcd.orientation === 90 || lcd.orientation === 270;
  const dw = isPortrait ? h : w;
  const dh = isPortrait ? w : h;
  ctx.translate(-dw / 2, -dh / 2);

  const grad = ctx.createLinearGradient(0, 0, 0, dh);
  grad.addColorStop(0, palette.bgTop);
  grad.addColorStop(1, palette.bgBot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, dw, dh);

  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  for (let y = 0; y < dh; y += 6) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(dw, y);
    ctx.stroke();
  }

  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, dw - 12, dh - 12);

  const padX = 20;
  const headerFontSize = isPortrait ? 24 : 28;
  const bodyFontSize = isPortrait ? 19 : 22;
  const lineStep = isPortrait ? 34 : 33;

  lines.forEach((line, idx) => {
    const yPos = 38 + idx * lineStep;
    if (yPos > dh - 14) return;
    if (idx === 0) {
      ctx.font = `700 ${headerFontSize}px "JetBrains Mono", monospace`;
      ctx.fillStyle = palette.text;
      ctx.fillText(line, padX, yPos);

      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padX, yPos + 8);
      ctx.lineTo(dw - padX, yPos + 8);
      ctx.stroke();
    } else {
      ctx.font = `600 ${bodyFontSize}px "JetBrains Mono", monospace`;
      ctx.fillStyle = idx % 2 === 1 ? palette.text : palette.sub;
      ctx.fillText(line, padX, yPos + 8);
    }
  });

  ctx.restore();
}

export function createLcdTextureBundle(maxAnisotropy: number = 4) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return { canvas, texture };
}
