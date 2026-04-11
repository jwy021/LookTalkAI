export class TtsService {
    static speak(text, personality = 'calm') {
        // 혹시 이전에 읽고 있던 말이 있으면 끊기
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ko-KR';

        // 성격별로 목소리 톤과 속도 조절
        if (personality === 'bright') {
            utterance.pitch = 1.4; // 통통 튀는 높은 톤
            utterance.rate = 1.15; // 살짝 빠른 속도
        } else if (personality === 'tsundere') {
            utterance.pitch = 0.8; // 낮고 시크한 톤
            utterance.rate = 1.0;
        } else if (personality === 'assistant') {
            utterance.pitch = 1.0;
            utterance.rate = 1.1;  // 또박또박 약간 빠르게
        } else {
            // calm (기본값)
            utterance.pitch = 0.9; // 차분하고 낮은 톤
            utterance.rate = 0.95;
        }

        window.speechSynthesis.speak(utterance);
    }

    static stop() {
        window.speechSynthesis.cancel();
    }
}