# `example.json` 과 `pose_tracking_15sec.json` 의 차이점 및 변환을 통한 해결 전략

사용자께서 겪고 계신 **"pose_tracking은 잘 되는데 example은 뼈대나 움직임이 이상하게 꼬여서 잘 안 나오는 현상"**의 근본적인 원인과, 이를 해결하기 위해 `example.json`을 `pose_tracking` 형식으로 재가공(Convert)하여 활용하는 방법을 분석한 문서입니다.

---

## 1. 대체 왜 `example.json`은 재생(SkeletonReplay)이 깨질까요?

`SkeletonReplay.tsx`를 통해 `example.json`의 회전값(Quaternion)을 아바타에 직접 주입했을 때 관절이 기괴하게 꺾이거나 동작이 엉망이 되는 이유는 데이터가 틀려서가 아니라, **3D 모델(Xbot)과 데이터(example.json) 간의 뼈대 기준축(Axis)과 기본 자세(Rest Pose)가 일치하지 않기 때문**입니다.

1. **Rest Pose(차렷 자세)의 차이:** 
   일반적으로 3D 모델(Xbot)은 양팔을 벌린 **T-pose**가 회전 값이 (0,0,0)인 기본 상태입니다. 하지만 `example.json` 데이터를 추출한 원본 시스템은 양팔을 비스듬히 내린 **A-pose**가 기본 상태일 확률이 높습니다. 기준점이 다르니 같은 각도를 입력해도 팔이 몸을 파고들거나 엉뚱한 곳을 가리킵니다.
2. **뼈의 로컬 축(Local Axis) 차이:** 
   어떤 시스템은 뼈가 길어지는 방향을 Y축으로 쓰고, 어떤 시스템은 X축이나 Z축으로 사용합니다. `example.json`의 시스템과 Three.js(Mixamo 모델) 간에 +X, +Y, +Z가 의미하는 방향이 서로 달라서 팔꿈치가 위아래가 아닌 좌우로 꺾이게 됩니다.

반면, `pose_tracking` 파일이 작동하는 **기존의 방식(Skeleton3D.tsx)**은 각도를 직접 넣는 게 아니라 **"점과 점(점 좌표)을 이어서 방향을 계산"**하기 때문에 뼈대의 기본 로컬 축이 어떻게 생겼든 무시하고 방향을 완벽하게 맞출 수 있어서 훨씬 안정적입니다.

---

## 2. 해결책: `example.json`을 `pose_tracking` 포맷으로 변환(Mapping)

`example.json`의 꼬임 문제를 완벽하게 회피하는 방법은, 그 파일 안에 있는 회전값(`rotation_local`)을 전부 무시하고, 각 관절의 **절대 위치 점 데이터(`position_world`)만 쏙 빼내서 MediaPipe의 33개 랜드마크 배열 포맷(`pose_tracking`)으로 둔갑**시키는 것입니다. 

### ▶ 매핑(Mapping) 테이블 가이드
`example.json`의 `player_1_pro.joints` 에 들어있는 이름표들을, `pose_tracking_15sec.json`에 쓰이던 MediaPipe 33개 번호표에 맞게 대입해 줍니다. 

| MediaPipe 인덱스명 (번호) | `example.json` 내 매칭되는 Joint 이름 | 사용할 데이터 (위치 벡터) |
| :--- | :--- | :--- |
| **Nose (0)** | `Head` | `position_world` [x,y,z] |
| **LeftShoulder (11)** | `LeftShoulder` | `position_world` [x,y,z] |
| **RightShoulder (12)** | `RightShoulder` | `position_world` [x,y,z] |
| **LeftElbow (13)** | `LeftElbow` | `position_world` [x,y,z] |
| **RightElbow (14)** | `RightElbow` | `position_world` [x,y,z] |
| **LeftWrist (15)** | `LeftWrist` | `position_world` [x,y,z] |
| **RightWrist (16)** | `RightWrist` | `position_world` [x,y,z] |
| **LeftHip (23)** | `LeftHip` | `position_world` [x,y,z] |
| **RightHip (24)** | `RightHip` | `position_world` [x,y,z] |
| **LeftKnee (25)** | `LeftKnee` | `position_world` [x,y,z] |
| **RightKnee (26)** | `RightKnee` | `position_world` [x,y,z] |
| **LeftAnkle (27)** | `LeftAnkle` | `position_world` [x,y,z] |
| **RightAnkle (28)** | `RightAnkle` | `position_world` [x,y,z] |
| *(얼굴, 손가락 등 나머지 번호)* | *(매칭 생략 또는 근처 관절 복사)* | (0,0,0) 또는 대략적인 위치 |

### ▶ 가공(Processing) 로직 설계도
간단한 Javascript(또는 Python) 스크립트를 작성하여 다음과 같이 변환합니다.

```javascript
/* 변환 스크립트 핵심 로직 예시 */
const newTrackingData = exampleJson.animation_data.map(frame => {
  const joints = frame.player_1_pro.joints;
  const landmarks = new Array(33).fill({ x: 0, y: 0, z: 0 }); // 33개 빈 배열 생성

  // 특정 위치에 example.json의 position_world 좌표 [x, y, z] 대입 (스케일 보정 필요)
  landmarks[11] = { x: joints.LeftShoulder.position_world[0], y: joints.LeftShoulder.position_world[1], z: joints.LeftShoulder.position_world[2] };
  landmarks[12] = { x: joints.RightShoulder.position_world[0], y: joints.RightShoulder.position_world[1], z: joints.RightShoulder.position_world[2] };
  landmarks[13] = { x: joints.LeftElbow.position_world[0], y: joints.LeftElbow.position_world[1], z: joints.LeftElbow.position_world[2] };
  // ... 이런 식으로 주요 관절(어깨, 팔꿈치, 손목, 골반, 무릎, 발목)을 전부 채움 ...

  return {
    time_sec: frame.timestamp_ms / 1000,
    landmarks: landmarks
  };
});
```

---

## 3. 요약 및 이후 제안

`example.json`의 회전(Quaternion) 데이터는 Xbot 모델 시스템과 축(Axis)이 맞지 않아 그대로 호환하기 까다롭습니다. 
따라서 작동이 매우 잘 되는 기존의 `Skeleton3D.tsx` 방향 벡터(IK) 시스템을 그대로 활용하기 위해, **`example.json` 안의 "관절 위치(position_world)" 배열만 모아서 `pose_tracking_15sec.json` 과 똑같은 33개짜리 포맷으로 가공(Mapping)하는 방식**이 가장 현명하고 확실한 해결책입니다.

이 변환 로직을 `App.tsx`나 특정 컨버터 스크립트로 짜드려서, `example.json`도 `Skeleton3D` 컴포넌트 환경에서 포즈를 이어서(점 기반 연결로) 재생되도록 작업해 드릴까요?
