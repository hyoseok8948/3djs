import React, { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import Skeleton3D from "./Skeleton3D";

interface SkeletonReplayProps {
  animData?: any; // The whole array "animation_data" from example.json
  isPlaying?: boolean;
}

// MediaPipe 33개 랜드마크 인덱스 매핑 테이블
// example.json의 joint 이름을 MediaPipe 번호로 변환합니다.
const mpIndexMap: Record<string, number> = {
  Head: 0, 
  // 기존 Skeleton3D는 웹캠 거울모드(오른팔->왼쪽화면)를 기본으로 짜여있습니다.
  // example.json은 해부학적 절대 좌표이므로, 크로스(꼬임)를 방지하기 위해 
  // Left 데이터를 아바타의 Left를 제어하는 번호(12,14,16)에 강제로 매핑합니다!
  LeftShoulder: 12, 
  RightShoulder: 11,
  LeftElbow: 14,
  RightElbow: 13,
  LeftWrist: 16,
  RightWrist: 15,
  LeftHip: 24,
  RightHip: 23,
  LeftKnee: 26,
  RightKnee: 25,
  LeftAnkle: 28,
  RightAnkle: 27,
  LeftToe: 32,
  RightToe: 31,
  LeftHand: 20, 
  RightHand: 19
};

export default function SkeletonReplay({
  animData,
  isPlaying = true,
}: SkeletonReplayProps) {
  
  // Skeleton3D에 전달할 33개의 랜드마크 배열 상태
  const [currentLandmarks, setCurrentLandmarks] = useState<any[]>([]);

  // Replay 시간 추적용 Ref
  const startTimeRef = useRef<number>(0);

  // Handle animation play loop
  useFrame(() => {
    if (!isPlaying || !animData || animData.length === 0) return;

    if (startTimeRef.current === 0) {
      startTimeRef.current = performance.now();
    }

    const elapsedMs = performance.now() - startTimeRef.current;
    
    // Find the current frame based on elapsed time (간단한 순차 검색)
    let frameData = animData[0];
    for (let i = 0; i < animData.length; i++) {
      if (animData[i].timestamp_ms > elapsedMs) {
        break;
      }
      frameData = animData[i];
    }

    // Loop animation (끝나면 처음으로)
    if (elapsedMs > animData[animData.length - 1].timestamp_ms) {
      startTimeRef.current = performance.now();
    }

    // --- 데이터 변환 (Mapping) 핵심 로직 ---
    const playerJoints = frameData?.player_1_pro?.joints;
    if (playerJoints) {
      // 33개의 빈 랜드마크 배열 생성 (기본값 0)
      const newLandmarks = new Array(33).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));

      Object.keys(playerJoints).forEach((jsonJointName) => {
        const mpIndex = mpIndexMap[jsonJointName];
        if (mpIndex !== undefined && playerJoints[jsonJointName].position_world) {
          const [px, py, pz] = playerJoints[jsonJointName].position_world;
          
          // example.json은 이미 Y축 위가 양수(+0.65 등)이고 아래가 음수(-0.74 등)입니다!
          // 마이너스 기호를 붙이면 아바타가 거꾸로(Upside-down) 뒤집히므로 양수 그대로 사용합니다.
          // 전체적인 스케일(크기)을 Xbot에 맞게 약 3배로 적절히 키워줍니다.
          newLandmarks[mpIndex] = {
            x: px * 3,       
            y: py * 3,       // 뒤집힘 방지 (양수 유지)
            z: pz * 3        
          };
        }
      });

      setCurrentLandmarks(newLandmarks);
    }
  });

  // Skeleton3D(기존의 강력한 점 연결 뼈대 시스템)를 그대로 재사용합니다!
  return (
    <Skeleton3D 
      landmarks={currentLandmarks} 
      mirrored={false} // 좌우 매핑을 위에서 잡았으므로 거울반전은 끕니다
      landmarkScale={1} 
    />
  );
}
