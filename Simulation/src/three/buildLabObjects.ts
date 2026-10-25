import * as THREE from 'three';
import { LabSceneObject, SelectableTarget } from '../types/simulator';

function markObjectSelectable(
  root: THREE.Group,
  objectId: string,
  selectableList: THREE.Object3D[]
) {
  const target: SelectableTarget = { kind: 'scene-object', objectId };
  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.userData.selectable = target;
      child.castShadow = true;
      child.receiveShadow = true;
      selectableList.push(child);
    }
  });
}

/**
 * Build composite multi-part 3D laboratory objects (Wall, Human, Box, Cylinder, Ramp, Rough Terrain)
 * grounded cleanly at y = 0 bottom-center, matching exact collision dimensions in `collision.ts`.
 */
export function createLabObjectGroup(
  obj: LabSceneObject,
  selectableList: THREE.Object3D[]
): {
  group: THREE.Group;
  collisionBox: THREE.LineSegments;
  collisionMat: THREE.LineBasicMaterial;
} {
  const group = new THREE.Group();
  group.name = `LabObj_${obj.id}`;

  const primaryColor = new THREE.Color(obj.color);

  if (obj.type === 'wall') {
    // Solid Industrial Barrier Wall: exact unscaled outer bounds 1.60m (X) x 0.65m (Y) x 0.16m (Z), grounded at y=0
    const panelMat = new THREE.MeshStandardMaterial({
      color: primaryColor,
      roughness: 0.56,
      metalness: 0.24,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.48,
      metalness: 0.45,
    });
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.42,
      metalness: 0.12,
    });

    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.16), frameMat);
    plinth.position.set(0, 0.025, 0);
    group.add(plinth);

    const coreWall = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.56, 0.14), panelMat);
    coreWall.position.set(0, 0.33, 0);
    group.add(coreWall);

    const topCap = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.16), frameMat);
    topCap.position.set(0, 0.63, 0);
    group.add(topCap);

    [-0.775, 0, 0.775].forEach((px) => {
      const stanchion = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.65, 0.16), frameMat);
      stanchion.position.set(px, 0.325, 0);
      group.add(stanchion);
    });

    const hazardBand = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.048, 0.146), stripeMat);
    hazardBand.position.set(0, 0.47, 0);
    group.add(hazardBand);
  } else if (obj.type === 'human') {
    // Composite 10-part articulated-looking Lab Operator / Person model (1.72m tall, grounded at y=0)
    const matShoes = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
    const matTrousers = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.65 });
    const matJacket = new THREE.MeshStandardMaterial({
      color: primaryColor,
      roughness: 0.48,
      metalness: 0.05,
    });
    const matSkin = new THREE.MeshStandardMaterial({ color: 0xe2b89b, roughness: 0.55 });
    const matHair = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.75 });
    const matVisor = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.15,
      metalness: 0.6,
    });

    [-0.1, 0.1].forEach((lx) => {
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.22), matShoes);
      shoe.position.set(lx, 0.035, 0.03);
      group.add(shoe);

      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.055, 0.76, 16), matTrousers);
      leg.position.set(lx, 0.45, 0);
      group.add(leg);
    });

    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.2), matTrousers);
    pelvis.position.set(0, 0.86, 0);
    group.add(pelvis);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.22), matJacket);
    torso.position.set(0, 1.18, 0);
    group.add(torso);

    const badge = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.08, 0.01),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 })
    );
    badge.position.set(0.1, 1.28, 0.115);
    group.add(badge);

    [-0.23, 0.23].forEach((ax) => {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.042, 0.56, 14), matJacket);
      arm.position.set(ax, 1.12, 0);
      arm.rotation.z = ax < 0 ? 0.06 : -0.06;
      group.add(arm);

      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.044, 14, 12), matSkin);
      hand.position.set(ax * 1.08, 0.82, 0);
      group.add(hand);
    });

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.09, 14), matSkin);
    neck.position.set(0, 1.46, 0);
    group.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 22, 18), matSkin);
    head.scale.set(0.92, 1.08, 0.96);
    head.position.set(0, 1.59, 0);
    group.add(head);

    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
      matHair
    );
    hair.position.set(0, 1.61, -0.01);
    group.add(hair);

    const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.036, 0.03), matVisor);
    glasses.position.set(0, 1.6, 0.1);
    group.add(glasses);
  } else if (obj.type === 'box') {
    // Composite Industrial Calibration Box (0.4 x 0.36 x 0.4, grounded at y=0)
    const crateMat = new THREE.MeshStandardMaterial({
      color: primaryColor,
      roughness: 0.52,
      metalness: 0.1,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.4,
      metalness: 0.55,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.34, 0.38), crateMat);
    body.position.set(0, 0.18, 0);
    group.add(body);

    const baseFrame = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.4), trimMat);
    baseFrame.position.set(0, 0.015, 0);
    const lidFrame = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.4), trimMat);
    lidFrame.position.set(0, 0.345, 0);
    group.add(baseFrame, lidFrame);

    [-0.185, 0.185].forEach((cx) => {
      [-0.185, 0.185].forEach((cz) => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.36, 0.032), trimMat);
        post.position.set(cx, 0.18, cz);
        group.add(post);
      });
    });
  } else if (obj.type === 'cylinder') {
    // Composite Padded Test Pillar (radius 0.20 base, height 0.56, grounded at y=0)
    const cylMat = new THREE.MeshStandardMaterial({
      color: primaryColor,
      roughness: 0.42,
      metalness: 0.18,
    });
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.35,
      metalness: 0.1,
    });
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.6,
      metalness: 0.4,
    });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 28), baseMat);
    base.position.set(0, 0.02, 0);
    const main = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.5, 28), cylMat);
    main.position.set(0, 0.29, 0);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.173, 0.173, 0.06, 28), ringMat);
    stripe.position.set(0, 0.4, 0);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.02, 28), baseMat);
    cap.position.set(0, 0.55, 0);
    group.add(base, main, stripe, cap);
  } else if (obj.type === 'ramp') {
    // Composite Incline Test Ramp with traction cleats (0.74 wide x 0.24 high x 0.90 long)
    const wedgeShape = new THREE.Shape();
    wedgeShape.moveTo(-0.45, 0);
    wedgeShape.lineTo(0.45, 0);
    wedgeShape.lineTo(0.45, 0.23);
    wedgeShape.lineTo(0.28, 0.23);
    wedgeShape.closePath();

    const wedgeGeo = new THREE.ExtrudeGeometry(wedgeShape, {
      depth: 0.74,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.004,
      bevelThickness: 0.004,
    });
    wedgeGeo.rotateY(Math.PI / 2);
    wedgeGeo.translate(-0.37, 0, 0);

    const rampMat = new THREE.MeshStandardMaterial({
      color: primaryColor,
      roughness: 0.65,
      metalness: 0.22,
    });
    const cleatMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.5,
      metalness: 0.15,
    });
    const rampMesh = new THREE.Mesh(wedgeGeo, rampMat);
    group.add(rampMesh);

    for (let i = 1; i <= 5; i++) {
      const t = i / 6;
      const z = -0.45 + t * 0.73;
      const y = t * 0.23 + 0.005;
      const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.008, 0.022), cleatMat);
      cleat.position.set(0, y, z);
      cleat.rotation.x = -Math.atan2(0.23, 0.73);
      group.add(cleat);
    }
  } else {
    // Walkable Rough Terrain Test Tray (0.96 x 0.96m low floor pad — non-blocking surface)
    const trayMat = new THREE.MeshStandardMaterial({
      color: 0x292524,
      roughness: 0.72,
      metalness: 0.2,
    });
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.024, 0.96), trayMat);
    tray.position.set(0, 0.012, 0);
    group.add(tray);

    const rockColors = [0x57534e, 0x78716c, 0x44403c, 0x64748b];
    for (let gx = -3; gx <= 3; gx++) {
      for (let gz = -3; gz <= 3; gz++) {
        const seed = Math.abs(Math.sin(gx * 12.9898 + gz * 78.233));
        const h = 0.022 + seed * 0.055;
        const w = 0.095 + (seed % 0.03);
        const stone = new THREE.Mesh(
          new THREE.CylinderGeometry(w * 0.48, w * 0.62, h, 6),
          new THREE.MeshStandardMaterial({
            color: rockColors[(gx + gz + 12) % rockColors.length],
            roughness: 0.85,
            metalness: 0.05,
          })
        );
        stone.position.set(gx * 0.12, 0.024 + h * 0.5, gz * 0.12);
        stone.rotation.y = seed * Math.PI;
        group.add(stone);
      }
    }
  }

  markObjectSelectable(group, obj.id, selectableList);

  // Build wireframe detection/collision indicator box
  const box3 = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box3.getSize(size);
  box3.getCenter(center);

  const wireGeo = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(size.x + 0.04, size.y + 0.04, size.z + 0.04)
  );
  const collisionMat = new THREE.LineBasicMaterial({ color: 0xf59e0b });
  const collisionBox = new THREE.LineSegments(wireGeo, collisionMat);
  collisionBox.position.copy(center);
  collisionBox.visible = false;
  collisionBox.raycast = () => {};
  group.add(collisionBox);

  group.position.set(obj.position[0], obj.position[1], obj.position[2]);
  group.rotation.set(
    THREE.MathUtils.degToRad(obj.rotation[0]),
    THREE.MathUtils.degToRad(obj.rotation[1]),
    THREE.MathUtils.degToRad(obj.rotation[2])
  );
  group.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);

  return { group, collisionBox, collisionMat };
}
