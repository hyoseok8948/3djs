import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";

interface Landmark {
  x: number;
  y: number;
  z: number;
}

interface Skeleton3DProps {
  landmarks: Landmark[];
  /** 입력이 미러(전면카메라/좌우반전)면 true */
  mirrored?: boolean;
  /** 뼈대 헬퍼 표시 */
  debug?: boolean;
  /** 랜드마크 스케일(너의 데이터 스케일에 맞춰 조절) */
  landmarkScale?: number;
  /** 현재 영상의 카메라 시점. (앞, 뒤, 양옆) */
  viewMode?: 'front' | 'rear' | 'side-left' | 'side-right';
}

type BoneInfo = { bone: THREE.Bone; restQuat: THREE.Quaternion; restAxis: THREE.Vector3 };

export default function Skeleton3D({
  landmarks,
  mirrored = false,
  debug = false,
  landmarkScale = 1,
  viewMode = 'front',
}: Skeleton3DProps) {
  const xbotUrl =
    "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/models/gltf/Xbot.glb";
  const { scene, nodes } = useGLTF(xbotUrl) as any;

  // --- 1) 재사용 객체(할당 최소화)
  const tmpV1 = useRef(new THREE.Vector3()).current;
  const tmpV2 = useRef(new THREE.Vector3()).current;
  const tmpV3 = useRef(new THREE.Vector3()).current;
  const tmpQ1 = useRef(new THREE.Quaternion()).current;
  const tmpQ2 = useRef(new THREE.Quaternion()).current;
  const tmpQ3 = useRef(new THREE.Quaternion()).current;

  // --- 2) Mesh material 세팅 (useEffect가 맞음)
  useEffect(() => {
    scene.traverse((child: any) => {
      if (!child?.isMesh) return;

      const applyMat = (mat: any) => {
        if (!mat) return;
        if ("envMapIntensity" in mat) mat.envMapIntensity = 1.0;
        if ("roughness" in mat) mat.roughness = 0.5;
        if ("metalness" in mat) mat.metalness = 0.5;
      };

      if (Array.isArray(child.material)) child.material.forEach(applyMat);
      else applyMat(child.material);

      child.castShadow = true;
      child.receiveShadow = true;
    });
  }, [scene]);

  // --- 3) Bone 가져오기: nodes에 없으면 traverse로 찾아서 캐시
  const boneCache = useRef(new Map<string, THREE.Bone>());
  const getBone = (name: string): THREE.Bone | undefined => {
    const cached = boneCache.current.get(name);
    if (cached) return cached;

    const direct = nodes?.[name];
    if (direct?.isBone) {
      boneCache.current.set(name, direct);
      return direct;
    }

    let found: THREE.Bone | undefined;
    scene.traverse((obj: any) => {
      if (found) return;
      if (obj?.isBone && obj.name === name) found = obj;
    });

    if (found) boneCache.current.set(name, found);
    return found;
  };

  // --- 4) 우리가 쓸 bones 목록
  const boneNames = useMemo(
    () => [
      "mixamorigHips",
      "mixamorigSpine",
      "mixamorigRightArm",
      "mixamorigRightForeArm",
      "mixamorigLeftArm",
      "mixamorigLeftForeArm",
      "mixamorigRightUpLeg",
      "mixamorigRightLeg",
      "mixamorigLeftUpLeg",
      "mixamorigLeftLeg",
    ],
    []
  );

  // --- 5) restQuat + restAxis(자동 추정) 저장
  const boneInfoMap = useRef(new Map<string, BoneInfo>());

  useEffect(() => {
    boneInfoMap.current.clear();

    boneNames.forEach((name) => {
      const bone = getBone(name);
      if (!bone) return;

      // rest quaternion (기본 포즈 회전)
      const restQuat = bone.quaternion.clone();

      // restAxis 자동 추정:
      // "첫 번째 자식 bone 방향"을 local axis로 삼는다 (가장 안정적)
      const childBone = bone.children.find((c: any) => c?.isBone) as THREE.Bone | undefined;
      const restAxis = childBone
        ? childBone.position.clone().normalize()
        : new THREE.Vector3(0, 1, 0);

      boneInfoMap.current.set(name, { bone, restQuat, restAxis });
    });
  }, [boneNames, scene]); // nodes가 바뀌어도 scene 기준으로 찾으므로 scene만

  // --- 6) landmark -> vec3 (필요시 여기서 축 반전/원점이동 처리)
  const getLm = (i: number, out: THREE.Vector3) => {
    const lm = landmarks?.[i];
    if (!lm) return false;

    // ⚠️ 여기 좌표계는 네 데이터에 맞춰 조절 가능
    // 지금은 "그대로" + 스케일만 적용
    out.set(lm.x * landmarkScale, lm.y * landmarkScale, lm.z * landmarkScale);

    // 미러링(좌우반전) 옵션을 통해 X축을 1차적으로 계산
    if (mirrored) {
      out.x *= -1;
    }

    // 시점(카메라 앵글)에 따른 3D 축 강제 스왑(회전) 처리
    // MediaPipe의 Z축은 카메라와의 거리를 상대적으로 나타내지만 정확하지 않음.
    // X, Z 축을 교환/반전하여 아바타가 강제로 옆이나 뒤를 보게끔 월드 좌표를 재설정함.
    const tempX = out.x;
    const tempZ = out.z;

    switch (viewMode) {
      case 'rear':
        // 완벽한 뒷모습: 깊이(Z)가 반대. 무릎이 역관절로 꺾이는 걸 방지
        out.z = -tempZ; 
        break;
      case 'side-left':
        // 카메라가 선수의 왼쪽 면을 찍고 있을 때 (선수는 화면 오른쪽을 바라봄)
        out.x = -tempZ;  
        out.z = tempX; 
        break;
      case 'side-right':
        // 카메라가 선수의 오른쪽 면을 찍고 있을 때 (캡처된 영상처럼 선수가 화면 왼쪽을 바라봄)
        // 화면의 좌우(X) 이동이 실제로는 앞뒤(Z) 이동이 됨
        out.x = tempZ;   // 깊이가 좌우로
        out.z = -tempX;  // 좌우 이동이 깊이로 (90도 회전)
        break;
      case 'front':
      default:
        // 기본 상태 (변함 없음)
        break;
    }

    return true;
  };

  // --- 7) 프레임레이트 독립 스무딩 계수
  const dampingAlpha = (delta: number, k = 18) => {
    // alpha = 1 - exp(-k*dt)
    return 1 - Math.exp(-k * delta);
  };

  // --- 8) 핵심: bone을 "목표 방향"으로 정확히 조준 (restQuat 보존)
  const aimBone = (boneName: string, dirWorld: THREE.Vector3, alpha: number) => {
    const info = boneInfoMap.current.get(boneName);
    if (!info) return;

    const { bone, restQuat, restAxis } = info;
    if (!bone.parent) return;

    // world dir -> parent local dir
    bone.parent.getWorldQuaternion(tmpQ1); // parentWorldQuat
    tmpQ2.copy(tmpQ1).invert(); // invParentWorldQuat
    const dirLocal = tmpV3.copy(dirWorld).applyQuaternion(tmpQ2).normalize();

    // delta: restAxis -> dirLocal
    tmpQ3.setFromUnitVectors(restAxis, dirLocal);

    // target = restQuat * delta
    const targetQuat = tmpQ2; // 재사용
    targetQuat.copy(restQuat).multiply(tmpQ3);

    bone.quaternion.slerp(targetQuat, alpha);
  };

  // --- 9) (옵션) SkeletonHelper
  const skelHelper = useMemo(() => {
    if (!debug) return null;
    const helper = new THREE.SkeletonHelper(scene);
    (helper.material as any).linewidth = 2;
    return helper;
  }, [debug, scene]);

  useEffect(() => {
    if (!skelHelper) return;
    scene.add(skelHelper);
    return () => {
      scene.remove(skelHelper);
      skelHelper.geometry.dispose();
      (skelHelper.material as any).dispose?.();
    };
  }, [skelHelper, scene]);

  // 점프 감지를 위한 바닥 기준점(Baseline) Y값 저장용 Ref
  const baselineAnkleY = useRef<number | null>(null);
  
  // 골반 본의 초기 Y 높이(Rest Height) 저장용
  const initialHipHeight = useRef<number | null>(null);

  useFrame((_, delta) => {
    if (!landmarks || landmarks.length === 0) return;
    const alpha = dampingAlpha(delta, 18);

    // 필요한 포인트들
    const hasLS = getLm(11, tmpV1);
    const hasRS = getLm(12, tmpV2);
    if (!hasLS || !hasRS) return;

    const lShoulder = tmpV1.clone(); // 어쩔 수 없이 2~3개는 clone 허용(원하면 더 최적화 가능)
    const rShoulder = tmpV2.clone();

    const lHipV = new THREE.Vector3();
    const rHipV = new THREE.Vector3();
    const hasLH = getLm(23, lHipV);
    const hasRH = getLm(24, rHipV);

    // 1) 척추 방향(hipCenter -> shoulderCenter)
    if (hasLH && hasRH) {
      const shoulderCenter = new THREE.Vector3().addVectors(lShoulder, rShoulder).multiplyScalar(0.5);
      const hipCenter = new THREE.Vector3().addVectors(lHipV, rHipV).multiplyScalar(0.5);
      const spineDir = new THREE.Vector3().subVectors(shoulderCenter, hipCenter).normalize();

      aimBone("mixamorigSpine", spineDir, alpha);
      // hips도 spineDir로 “위 방향”만 맞춰줘도 전체가 안정됨
      aimBone("mixamorigHips", spineDir, alpha * 0.6);
    }

    // 2) 팔/다리: 항상 “관절->다음관절” 방향으로 aim
    // 오른팔(아바타) = 사용자 왼팔(11,13,15) / 왼팔(아바타) = 사용자 오른팔(12,14,16)
    // (이 좌우 매핑은 네가 원래 쓰던 그대로 유지)

    // 사용자 왼팔
    const lElbow = new THREE.Vector3();
    const lWrist = new THREE.Vector3();
    const hasLE = getLm(13, lElbow);
    const hasLW = getLm(15, lWrist);

    if (hasLS && hasLE) {
      const dir = new THREE.Vector3().subVectors(lElbow, lShoulder).normalize();
      aimBone("mixamorigRightArm", dir, alpha);
    }
    if (hasLE && hasLW) {
      const dir = new THREE.Vector3().subVectors(lWrist, lElbow).normalize();
      aimBone("mixamorigRightForeArm", dir, alpha);
    }

    // 사용자 오른팔
    const rElbow = new THREE.Vector3();
    const rWrist = new THREE.Vector3();
    const hasRE = getLm(14, rElbow);
    const hasRW = getLm(16, rWrist);

    if (hasRS && hasRE) {
      const dir = new THREE.Vector3().subVectors(rElbow, rShoulder).normalize();
      aimBone("mixamorigLeftArm", dir, alpha);
    }
    if (hasRE && hasRW) {
      const dir = new THREE.Vector3().subVectors(rWrist, rElbow).normalize();
      aimBone("mixamorigLeftForeArm", dir, alpha);
    }

    // 사용자 왼다리(23,25,27) -> 아바타 오른다리
    const lKnee = new THREE.Vector3();
    const lAnkle = new THREE.Vector3();
    const hasLK = getLm(25, lKnee);
    const hasLA = getLm(27, lAnkle);

    if (hasLH && hasLK) {
      const dir = new THREE.Vector3().subVectors(lKnee, lHipV).normalize();
      aimBone("mixamorigRightUpLeg", dir, alpha);
    }
    if (hasLK && hasLA) {
      const dir = new THREE.Vector3().subVectors(lAnkle, lKnee).normalize();
      aimBone("mixamorigRightLeg", dir, alpha);
    }

    // 사용자 오른다리(24,26,28) -> 아바타 왼다리
    const rKnee = new THREE.Vector3();
    const rAnkle = new THREE.Vector3();
    const hasRK = getLm(26, rKnee);
    const hasRA = getLm(28, rAnkle);

    if (hasRH && hasRK) {
      const dir = new THREE.Vector3().subVectors(rKnee, rHipV).normalize();
      aimBone("mixamorigLeftUpLeg", dir, alpha);
    }
    if (hasRK && hasRA) {
      const dir = new THREE.Vector3().subVectors(rAnkle, rKnee).normalize();
      aimBone("mixamorigLeftLeg", dir, alpha);
    }

    // ==========================================
    // 3) 점프(Vertical Translation) 구현 로직 추가
    // ==========================================
    if (hasLA && hasRA) {
      // 1. 영상 상의 두 발목 중 '가장 아래에 있는(Y값이 큰)' 발목 좌표를 찾음
      // 화면 좌표계는 아래로 갈수록 Y가 감소하므로 Math.min 사용 (Threejs 기준)
      // *주의: normalizeLandmarks 에서 변환된 값을 사용하므로 화면 아래쪽 방향이 -Y일 수 있습니다.
      const currentLowestAnkleY = Math.min(lAnkle.y, rAnkle.y); 
      
      // 2. 초기 바닥 기준점(Baseline) 세팅 (첫 프레임 또는 리셋 시)
      if (baselineAnkleY.current === null) {
        baselineAnkleY.current = currentLowestAnkleY;
      }

      const hipsBone = boneInfoMap.current.get("mixamorigHips")?.bone;
      
      if (hipsBone) {
        // 골반 본의 원래 높이(Rest Height) 저장
        if (initialHipHeight.current === null) {
          initialHipHeight.current = hipsBone.position.y;
        }

        // 3. 현재 발목 높이와 기준 바닥의 차이 계산 (Delta Y)
        // 만약 두 발목이 바닥(Baseline)보다 위로 올라가면(Y값이 커지면), 점프한 것으로 간주
        let deltaY = currentLowestAnkleY - baselineAnkleY.current;
        
        // 오차 보정: 약간의 Y 흔들림은 무시하고, 바닥 아래로 파고들지 않게 함 (점프만 허용)
        if (deltaY < 0.1) deltaY = 0; // threshold 값 (필요시 조절)
        
        // 4. 골반 본에 수직 이동(Translate Y) 속성 부드럽게 적용
        // 스케일 팩터(jumpScale)를 곱해서 점프 높이를 증폭시킬 수 있음
        const targetHipHeight = initialHipHeight.current + (deltaY * 1.5); // 1.5는 점프 스케일 가중치
        
        // 급하게 뜨지 않도록 lerp로 부드럽게 보간
        hipsBone.position.y = THREE.MathUtils.lerp(hipsBone.position.y, targetHipHeight, alpha);
        
        // (옵션) 골반 기준점을 서서히 현재 위치로 갱신하여(Auto-calibration) 카메리가 움직이는 영상에 대비
        baselineAnkleY.current = THREE.MathUtils.lerp(baselineAnkleY.current, currentLowestAnkleY - deltaY, 0.01);
      }
    }

    if (skelHelper) skelHelper.updateMatrixWorld(true);
  });

  return (
    <>
      <OrbitControls target={[0, -1, 0]} />

      <group position={[0, -2, -3]} scale={[1.8, 1.8, 1.8]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[10, 10]} />
          <meshStandardMaterial color="#333333" transparent opacity={0.4} />
        </mesh>

        <primitive object={scene} />
      </group>
    </>
  );
}

useGLTF.preload(
  "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/models/gltf/Xbot.glb"
);