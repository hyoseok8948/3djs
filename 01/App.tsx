import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, Platform, TouchableOpacity } from 'react-native';
import { Canvas } from '@react-three/fiber';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import Skeleton3D from './Skeleton3D';
import SkeletonReplay from './SkeletonReplay';

// 추출해둔 15초 JSON 데이터 불러오기
import savedPoseData from './assets/pose/pose_tracking_15sec.json';
// 새로 추가된 고품질 Quaternion 애니메이션 데이터 불러오기
import examplePoseData from './assets/pose/example.json';

interface Landmark {
  x: number;
  y: number;
  z: number;
}

// 뒷모습 추적 시 해부학적 좌우 일치를 위한 데이터 반전 함수
const swapLeftRight = (landmarks: any[]) => {
  if (!landmarks || landmarks.length < 33) return landmarks;
  const newLms = [...landmarks];
  
  // MediaPipe 좌/우 인덱스를 서로 맞바춥니다.
  const swap = (i: number, j: number) => {
    const temp = newLms[i];
    newLms[i] = newLms[j];
    newLms[j] = temp;
  };

  // 얼굴
  swap(1, 4); swap(2, 5); swap(3, 6); // 눈
  swap(7, 8); // 귀
  swap(9, 10); // 입
  
  // 상체
  swap(11, 12); // 어깨
  swap(13, 14); // 팔꿈치
  swap(15, 16); // 손목
  swap(17, 18); // 새끼손가락
  swap(19, 20); // 집게손가락
  swap(21, 22); // 엄지손가락

  // 하체
  swap(23, 24); // 골반
  swap(25, 26); // 무릎
  swap(27, 28); // 발목
  swap(29, 30); // 뒷꿈치
  swap(31, 32); // 발끝

  return newLms;
};

const normalizeLandmarks = (landmarks: any[]): Landmark[] => {
  if (!landmarks || landmarks.length === 0) return [];
  
  return landmarks.map((mark) => {
    // 웹캠(MediaPipe) 좌표계 (0~1) -> R3F 3D 공간 좌표계 (-2~2 부근) 로 변환
    // y축은 MediaPipe가 위에서부터 0이므로 반전시킵니다.
    // 뒷모습 추적 + 해부학적 교환(Swap)을 사용할 때는 Z축(깊이)도 반전시켜 주어야
    // 무릎이나 팔꿈치가 올바른 방향(뒤쪽)으로 꺾이게 됩니다.
    return {
      x: (mark.x - 0.5) * -4,
      y: (mark.y - 0.5) * -4,
      z: mark.z * 2, // z 깊이값 크기 보정 (거울 모드가 아닐 경우 양수 곱셈으로 반전 효과)
    };
  });
};

export default function App() {
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const requestRef = useRef<number>(0);
  const isWeb = Platform.OS === 'web';
  const [modelStatus, setModelStatus] = useState<string>('AI 모델 로딩 중...');

  // 추가: 다중 인물 추적용 상태 관리
  const [targetPersonIndex, setTargetPersonIndex] = useState<number>(0);
  const targetPersonIndexRef = useRef<number>(0); // requestAnimationFrame 루프 내에서 최신 값을 참조하기 위해 사용
  const [detectedPosesCount, setDetectedPosesCount] = useState<number>(0);

  // 추가: 데이터 레코딩용 상태 관리
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const isRecordingRef = useRef<boolean>(false);
  const recordedDataRef = useRef<any[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const [recordProgress, setRecordProgress] = useState<string>('');

  // 추가: JSON 리플레이용 상태 관리
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const isReplayingRef = useRef<boolean>(false);
  const replayStartTimeRef = useRef<number>(0);

  const [isQuaternionReplaying, setIsQuaternionReplaying] = useState(false);
  const [viewMode, setViewMode] = useState<'front' | 'rear' | 'side-left' | 'side-right'>('rear'); // yellow.mp4는 완벽한 뒷모습
  useEffect(() => {
    const initPoseLandmarker = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU" // 웹 환경에서 WebGL/GPU 가속 사용
          },
          runningMode: "VIDEO",
          numPoses: 1, // yellow.mp4는 한 명만 나오므로 1로 변경
        });
        
        poseLandmarkerRef.current = landmarker;
        setModelStatus('AI 로딩 완료, 동영상 대기 중...');
        // startWebcam(); // 기존 웹캠 시작 부분 제거
      } catch (error) {
        console.error("MediaPipe 초기화 오류:", error);
        setModelStatus('AI 모델 로딩 실패');
      }
    };

    if (isWeb) initPoseLandmarker();

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (poseLandmarkerRef.current) poseLandmarkerRef.current.close();
    };
  }, [isWeb]);

  // 2. 비디오 준비 완료 시 추적 시작 함수 (웹캠 대체)
  const isTrackingStarted = useRef<boolean>(false);
  const handleVideoLoaded = () => {
    videoRef.current?.play();
    setModelStatus('모션 추적 시작 (동영상)');
    
    // 루프가 중복 실행되지 않도록 방어 코드
    if (!isTrackingStarted.current && !isReplayingRef.current) {
      isTrackingStarted.current = true;
      detectPose();
    }
  };

  // 3. 매 프레임별 AI 추적 루프 (비디오 모드)
  const detectPose = () => {
    // 리플레이 모드일 때는 비디오 추적 중단
    if (isReplayingRef.current) return;

    if (!videoRef.current || !poseLandmarkerRef.current || videoRef.current.readyState < 2) {
      requestRef.current = requestAnimationFrame(detectPose);
      return;
    }

    const startTimeMs = performance.now();
    let result: any = null;
    
    // 비디오 현재 프레임을 던져서 결과 받기 (동영상 루프 시 예외 처리 포함)
    try {
      result = poseLandmarkerRef.current.detectForVideo(videoRef.current, startTimeMs);
    } catch (e) {
      console.warn("Video frame jump error (likely loop refresh)", e);
    }

    if (result && result.landmarks && result.landmarks.length > 0) {
      const posesCount = result.landmarks.length;
      setDetectedPosesCount(posesCount);

      const validIndex = 0; // 한 명만 추적하므로 첫번째 데이터 고정
      
      // 변환된 좌표를 State에 업데이트 -> Skeleton3D로 전달됨
      // + 뒷모습이므로 swapLeftRight 함수를 거쳐 좌우 관절 데이터를 바꿉니다
      const swappedLandmarks = swapLeftRight(result.landmarks[validIndex]);
      const normalizedLandmarks = normalizeLandmarks(swappedLandmarks);
      setLandmarks(normalizedLandmarks);

      // 데이터 기록 중이라면 배열에 추가 (현재 시간과 함께)
      if (isRecordingRef.current) {
        const elapsedTime = (performance.now() - recordingStartTimeRef.current) / 1000;
        
        // 15초가 경과하면 자동 종료 및 다운로드
        if (elapsedTime >= 15) {
          stopRecordingAndDownload();
        } else {
          // 진행 시간 UI용 상태 업데이트 (약간의 쓰로틀링 효과를 위해 소수점 버림)
          setRecordProgress(`${elapsedTime.toFixed(1)}초 / 15.0초`);
          
          recordedDataRef.current.push({
            time_sec: Number(elapsedTime.toFixed(3)),
            landmarks: normalizedLandmarks
          });
        }
      }

    } else {
      setDetectedPosesCount(0);
    }

    // 다음 브라우저 프레임에 다시 예약
    requestRef.current = requestAnimationFrame(detectPose);
  };

  // 4. 레코딩 제어 함수
  const startRecording = () => {
    if (isRecording) return;
    recordedDataRef.current = [];
    recordingStartTimeRef.current = performance.now();
    isRecordingRef.current = true;
    setIsRecording(true);
    setRecordProgress('0.0초 / 15.0초');
    
    // 영상도 처음부터 다시 맞추려면 주석 해제 (옵션)
    // if (videoRef.current) videoRef.current.currentTime = 0;
  };

  const stopRecordingAndDownload = () => {
    isRecordingRef.current = false;
    setIsRecording(false);
    setRecordProgress('기록 완료!');

    const dataStr = JSON.stringify(recordedDataRef.current, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pose_tracking_15sec.json';
    document.body.appendChild(link);
    link.click();
    
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 5. JSON 데이터 리플레이(Replay) 재생 루프
  const playSavedJson = () => {
    if (!savedPoseData || savedPoseData.length === 0) return;

    // 비디오 정지 및 추적 루프 중단
    if (videoRef.current) videoRef.current.pause();
    isTrackingStarted.current = false;
    if (requestRef.current) cancelAnimationFrame(requestRef.current);

    isReplayingRef.current = true;
    setIsReplaying(true);
    setModelStatus('JSON 데이터 리플레이 중...');
    recordingStartTimeRef.current = performance.now(); // 리플레이 시작 시간 기준

    const loopReplay = () => {
      if (!isReplayingRef.current) return;

      const elapsedSec = (performance.now() - recordingStartTimeRef.current) / 1000;
      
      // JSON 배열에서 현재 재생 시간에 가장 근접한 프레임 데이터 찾기
      // (가장 단순한 순차 검색 형태)
      let currentFrameData = savedPoseData[0];
      for (let i = 0; i < savedPoseData.length; i++) {
        if (savedPoseData[i].time_sec > elapsedSec) {
          break; // 현재 시간보다 프레임 시간이 크면 이전 프레임 사용
        }
        currentFrameData = savedPoseData[i];
      }

      // JSON에 저장된 데이터는 이미 normalizeLandmarks가 적용된 결과이므로 그대로 세팅
      if (currentFrameData && currentFrameData.landmarks) {
        setLandmarks(currentFrameData.landmarks);
      }

      // 15초(데이터 끝)가 지나면 처음부터 무한 반복(루프) 처리
      if (elapsedSec >= savedPoseData[savedPoseData.length - 1].time_sec) {
        recordingStartTimeRef.current = performance.now(); // 시간 리셋
      }

      requestRef.current = requestAnimationFrame(loopReplay);
    };

    requestRef.current = requestAnimationFrame(loopReplay);
  };

  return (
    <View style={styles.container}>
      {/* 1. 웹캠 영상 렌더링 (웹에서만 동작) */}
      {isWeb ? (
        <View style={StyleSheet.absoluteFill}>
          <video
            ref={videoRef}
            src={require('./assets/video/yellow.mp4')} // 다시 원래 영상(yellow.mp4)으로 복귀
            playsInline
            muted
            loop
            onLoadedData={handleVideoLoaded}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              // transform: 'scaleX(-1)' // 거울 반전 제거 (사전 녹화 영상)
            }}
          />
        </View>
      ) : (
        <View style={styles.center}>
          <Text style={styles.text}>현재 코드는 웹 브라우저용입니다.</Text>
        </View>
      )}

      {/* 2. 3D Canvas 오버레이 (배경 투명) */}
      <View style={styles.canvasContainer} pointerEvents="none">
        <Canvas camera={{ position: [0, 0, 5], fov: 60 }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 10]} intensity={1.5} />
          
          {/* 상태가 바뀔 때마다 아바타 모델이 기존 꼬인 회전값을 물려받지 않고 
              아예 메모리에서 삭제된 후 새롭게(Fresh) 렌더링되도록 key 값을 강제 부여합니다. */}
          {isQuaternionReplaying ? (
            <SkeletonReplay 
              key="replay-mode" 
              animData={examplePoseData.animation_data} 
              isPlaying={isQuaternionReplaying} 
            />
          ) : (
            <Skeleton3D 
              key={`tracking-mode-${viewMode}`} 
              landmarks={landmarks} 
              viewMode={viewMode}
              mirrored={false} 
            />
          )}
        </Canvas>
      </View>

      {/* 3. 테스트용 UI 오버레이 */}
      <View style={styles.uiContainer} pointerEvents="box-none">
        <Text style={styles.uiText}>3D Video Tracking</Text>
        <Text style={styles.uiSubText}>상태: {modelStatus}</Text>
        {!isQuaternionReplaying && <Text style={styles.uiSubText}>인식된 사람 수: {detectedPosesCount}</Text>}

        <View style={styles.controls}>
          <Text style={styles.uiSubText}>추적 대상 선택: P{targetPersonIndex + 1}</Text>
          <View style={styles.buttons}>
            {[0, 1, 2, 3, 4].map((index) => (
              <TouchableOpacity 
                key={index} 
                style={[styles.button, targetPersonIndex === index && styles.activeButton]}
                onPress={() => {
                  setTargetPersonIndex(index);
                  targetPersonIndexRef.current = index; // 루프용 Ref 업데이트
                }}
              >
                <Text style={[styles.buttonText, targetPersonIndex === index && styles.activeButtonText]}>
                  P{index + 1}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={[styles.controls, { marginTop: 10 }]}>
          <Text style={styles.uiSubText}>움직임 데이터 추출 (15초)</Text>
          <TouchableOpacity 
            style={[styles.button, { marginTop: 5, backgroundColor: isRecording ? '#ff4444' : '#00ffff' }]}
            onPress={isRecording ? stopRecordingAndDownload : startRecording}
          >
            <Text style={[styles.activeButtonText, { color: isRecording ? 'white' : 'black' }]}>
              {isRecording ? '정지 및 저장 (진행중)' : '15초 데이터 기록 시작'}
            </Text>
          </TouchableOpacity>
          {isRecording && <Text style={{ color: '#ff4444', marginTop: 5 }}>{recordProgress}</Text>}
        </View>

        {/* 4. JSON 재생 토글 버튼 */}
        <View style={[styles.controls, { marginTop: 10 }]}>
          <Text style={styles.uiSubText}>JSON 데이터 온리(Video OFF)</Text>
          <TouchableOpacity 
            style={[styles.button, { marginTop: 5, backgroundColor: isReplaying ? '#ff00ff' : '#00ffff' }]}
            onPress={() => {
              if (isReplaying) {
                // 리플레이 종료 후 비디오 모드로 복귀
                isReplayingRef.current = false;
                setIsReplaying(false);
                handleVideoLoaded();
              } else {
                playSavedJson();
              }
            }}
          >
            <Text style={[styles.activeButtonText, { color: isReplaying ? 'white' : 'black' }]}>
              {isReplaying ? '비디오 추적으로 복귀' : 'JSON Replay 시작'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 카메라 시점 최적화(View Mode) 토글 */}
        {!isQuaternionReplaying && (
          <View style={[styles.controls, { marginTop: 10 }]}>
            <Text style={styles.uiSubText}>카메라 방향 최적화 (몸통 꼬임 해결)</Text>
            <TouchableOpacity 
              style={[styles.button, { marginTop: 5, backgroundColor: viewMode === 'front' ? '#FF9800' : viewMode === 'rear' ? '#2196F3' : '#9C27B0' }]}
              onPress={() => {
                const modes: ('front' | 'rear' | 'side-left' | 'side-right')[] = ['front', 'rear', 'side-left', 'side-right'];
                const nextIndex = (modes.indexOf(viewMode) + 1) % modes.length;
                setViewMode(modes[nextIndex]);
              }}
            >
              <Text style={styles.activeButtonText}>
                현재 시점: {viewMode.toUpperCase()}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 5. Quaternion (example.json) 재생 토글 버튼 */}
        <View style={[styles.controls, { marginTop: 10 }]}>
          <Text style={styles.uiSubText}>고품질 회전(Quaternion) 데이터</Text>
          <TouchableOpacity 
            style={[styles.button, { marginTop: 5, backgroundColor: isQuaternionReplaying ? '#ffaa00' : '#00ffff' }]}
            onPress={() => {
              if (isQuaternionReplaying) {
                setIsQuaternionReplaying(false);
                handleVideoLoaded(); // 다시 비디오 켬
              } else {
                if (videoRef.current) videoRef.current.pause();
                isTrackingStarted.current = false;
                if (requestRef.current) cancelAnimationFrame(requestRef.current);
                
                // 기존 리플레이도 끔
                isReplayingRef.current = false;
                setIsReplaying(false);

                setIsQuaternionReplaying(true);
                setModelStatus('Quaternion 데이터(example.json) 재생 중...');
              }
            }}
          >
            <Text style={[styles.activeButtonText, { color: isQuaternionReplaying ? 'black' : 'black' }]}>
              {isQuaternionReplaying ? '비디오 추적으로 복귀' : 'example.json 재생하기'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  text: { color: 'white', fontSize: 18 },
  canvasContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    backgroundColor: 'transparent',
  },
  uiContainer: { position: 'absolute', top: 20, left: 20, zIndex: 20 },
  uiText: { color: '#00ffff', fontSize: 24, fontWeight: 'bold' },
  uiSubText: { color: 'white', fontSize: 14, marginTop: 4 },
  controls: { 
    marginTop: 15, 
    backgroundColor: 'rgba(0,0,0,0.5)', 
    padding: 10, 
    borderRadius: 8 
  },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 10 },
  button: { 
    backgroundColor: '#333', 
    paddingVertical: 6, 
    paddingHorizontal: 12, 
    borderRadius: 4, 
    minWidth: 40,
    alignItems: 'center'
  },
  activeButton: { backgroundColor: '#00ffff' },
  buttonText: { color: 'white', fontWeight: '500' },
  activeButtonText: { color: 'black', fontWeight: 'bold' }
});
