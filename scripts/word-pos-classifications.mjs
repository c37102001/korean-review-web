import { isAllowedWordPos, normalizeWordPos } from '../src/words/partOfSpeech.js';

const words = {
  名詞: [
    '색깔 상품 시장 슈퍼마켓 테이블 편의점 디저트 마스크 바퀴벌레 손님 타이어 아우터 외투 땅 파일 폴더 반려동물 장난감 가위 알람 봉투 그릇 국수 자신 하늘 정장 소개팅 정답 시골 중학생 초등학생 뱀 작가 잘못 택배 보도 성적 힘 거리 촛불 위치 생신 소식 서양 능력 칠판 이불 벽 사교성 자체 이별 수리 경찰 약자 화학 수건 옛날 호수 조선시대 임신부 배경 문장 짜증 정리 도안 원룸 도둑 이웃 뒤 무용수 서류 소방관 후기 후보 거울 흙 빛 갈색 북극 여우 천적 사냥 무리 먹잇감 발자국 반품 사례 업체 거절 핑계 맘 모퉁이 추억'.split(' '),
    ['다음 날', '삶은 계란', '요리 계급 전쟁', '대학교 4학년'],
  ],
  動詞: ['빌리다 경험하다 바꾸다 들이다 다치다 유행하다 포기하다 다가가다 쉬다 속이다'.split(' ')],
  形容詞: ['습하다 조용하다 귀엽다 심각하다 정확하다 궁금하다 까다롭다 옅다'.split(' ')],
  副詞: ['나중에 갑자기 벌써 혹시 가볍게 못해도 푹 적절히 아낌없이 반짝 아스라이'.split(' ')],
  其他: ['저희 새로운 진정한 아무 얻기'.split(' ')],
  片語: [
    ['바랄게요', '살면서', '바라보고', '우울하거나', '맑았어요', '끝에'],
    ['해가 지다', '많이 없다', '휴가를 가다', '많이 안 가다', '대화를 하다',
      '설거지를 하다', '최선을 다하다', '사라지고 있다', '식고 있다',
      '생각이 들어서', '비를 맞다', '피해를 보다', '사람도 있다고 해요',
      '이렇게 느끼는 사람도 있다고 해요', '잠을 잤지만 안 잔 것 같아요.',
      '밤에 많이 안 어둡고 사람이 있어서 안 무서워요.'],
  ],
  固定表達: [['잘 못 알아들었어요.', '소원을 빌다', '첫눈에 반하다']],
};

const missingPosByKo = new Map();
for (const [pos, groups] of Object.entries(words)) {
  for (const group of groups) for (const ko of group) missingPosByKo.set(ko, pos);
}

export function classifyLegacyWordPos(item) {
  const mixedPosByKo = {
    현재: '名詞', 아무것도: '其他', 다들: '其他', 그래도: '副詞', 또는: '副詞',
    대부분: '副詞', 소극적: '名詞', 마련: '其他', 적극적: '名詞',
    지나치다: '動詞', 대신: '名詞', 그러므로: '副詞', 낫다: '形容詞',
    그러나: '副詞', 그럼에도: '副詞', '그렇지 않으면': '片語',
    나름: '名詞', 조차: '其他', 적다: '形容詞', 못: '副詞', 우선: '副詞', 공적: '名詞',
  };
  if (item.pos && !isAllowedWordPos(item.pos) && mixedPosByKo[item.ko]) return mixedPosByKo[item.ko];
  if (item.pos) return normalizeWordPos(item.pos);
  return missingPosByKo.get(item.ko) || '';
}
