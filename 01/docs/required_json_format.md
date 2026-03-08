# example.json 데이터 형식 가이드 및 변환 전략

이 문서는 사용자가 제공한 `assets/pose/example.json`의 데이터 구조를 분석하고, 현재 `App.tsx`와 `Skeleton3D.tsx`에서 사용 중인 MediaPipe 좌표 시스템과 호환성을 확보하기 위한 방법을 설명합니다.

---

## 1. 기존 데이터 vs 새로운 데이터(example.json) 비교

### 기존 방식 (`pose_tracking_15sec.json`)
*   **포맷 기반:** MediaPipe 33개 랜드마크 (배열)
*   **데이터 타입:** 각 관절의 절대적인 3D **위치 좌표** (`x`, `y`, `z`)
*   **아바타 적용 방식 (IK 방식):** 위치 좌표점(점과 점 사이)을 빼서 방향 벡터(Direction Vector)를 구한 뒤, 3D 모델의 각 관절(Bone)을 해당 방향으로 비틀어(LookAt/Quaternion) 줍니다. (예: 어깨 좌표와 팔꿈치 좌표를 이어 팔의 방향 결정)

### 새로운 방식 (`example.json`)
*   **포맷 기반:** 특정 계층 구조(Hierarchy)를 가진 본(Bone) 이름 단위 (객체)
*   **데이터 타입:** 각 관절의 위치 좌표(`position`)뿐만 아니라, **미리 계산된 3D 회전값(`rotation`, Quaternion)** 이 포함됨.
*   **아바타 적용 방식 (FK/애니메이션 클립 방식):** 별도의 방향 계산 없이, 파일에 적힌 회전값(`rotation_local` 혹은 `rotation_world`)을 아바타 모델의 뼈(Bone) `quaternion` 속성에 그대로 대입(Copy)하기만 하면 완벽한 자세가 나옵니다. 

---

## 2. 결론: "그대로 쓸 수 없고 가공(또는 재생 로직 변경)이 필요합니다"

현재 `Skeleton3D` 컴포넌트는 오직 **배열 형태의 [x, y, z] 좌표 33개**만을 받아들여 내부적으로 회전 각도를 역산하는 로직(`aimBone`)으로 짜여 있습니다. 
따라서 `example.json`에 있는 `"RightElbow": { "rotation": [...] }` 같은 정교한 계층적 회전 데이터를 현재 코드에 그대로 밀어 넣으면 에러가 발생하며 전혀 움직이지 않습니다.

---

## 3. `example.json`을 사용하기 위한 2가지 해결 방법

### 방법 A. 재생기(`Skeleton3D`) 로직 자체를 갈아엎기 (권장)
`example.json`은 사실 기존 방식보다 **훨씬 더 고급스럽고 정확한(전문 모션캡처 수준의) 데이터**입니다. 굳이 점들을 이어 방향을 찾을 필요 없이, 이미 주어진 '회전값(Quaternion)'을 바로 뼈대에 적용하면 되기 때문입니다.
1.  새로운 재생용 컴포넌트(예: `SkeletonReplay.tsx`)를 만듭니다.
2.  `useFrame` 안에서 현재 프레임의 `animation_data[n].player_1_pro.joints` 객체를 순회합니다.
3.  아바타의 각 Bone(예: `mixamorigRightArm`)을 찾아 `bone.quaternion.set(x, y, z, w)` 함수를 사용해 JSON에 적힌 `rotation_local` 값을 바로 복사하여 적용합니다.

### 방법 B. 데이터를 기존 좌표 배열 포맷으로 억지로 변환하기 (트랜스필터링)
JSON 파일의 형식을 기존 `pose_tracking_15sec.json` 구조에 맞게 Python 스크립트나 별도 함수를 이용해 파싱/변환하는 방법입니다.
1. `example.json`을 읽습니다.
2. 각 프레임의 `player_1_pro.joints.명칭.position_world` 안의 [x, y, z] 배열 값만 빼냅니다.
3. 이 값들을 MediaPipe의 33개 인덱스 순서에 맞게 억지로 매핑(Mapping) 시킵니다.
    * 예) `RightElbow.position_world` ➡️ `landmarks[14]`에 대입
4. 하지만 이 방법은 아바타마다 골격 길이(Scale)가 달라서 오차가 심해질 수 있으며, 기껏 제공받은 고급 회전 데이터(Quaternion)를 버리고 위치 점만 얻게 되어 동작 질이 떨어질 수 있습니다.

---

## 4. 진행 제안

만약 이 `example.json` 처럼 정교한 회전값(Quaternion)이 이미 들어있는 데이터를 앞으로 메인으로 쓰실 계획이라면, 기존의 `Skeleton3D`를 재사용하기보다는 **(방법 A) 해당 데이터 구조전용 3D 플레이어 로직을 새로 하나 추가하는 것**이 훨씬 똑똑하고 움직임 퀄리티도 좋습니다.

이 방향으로 `SkeletonReplay.tsx` 파일을 추가로 구현해 드릴까요?
