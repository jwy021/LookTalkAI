export class UIController {
    constructor() {
        this.widget = document.getElementById('widget');
        this.robotFace = document.getElementById('robot-face');
        this.speechBubble = document.getElementById('speech-bubble');
        this.mouthShape = document.getElementById('mouth-shape');
        this.antennaBall = document.getElementById('antenna-ball');
        this.typingTimerId = null;
        this.bubbleTimerId = null;
        this.stateTimerId = null; // 상태 복구용 타이머

        this.initBlinking(); // 눈 깜빡임 로직 초기화
    }


    // 평상시(idle) 눈 깜빡임
    initBlinking() {
        setInterval(() => {
            if (this.widget.getAttribute('data-state') === 'idle') {
                const eyes = document.querySelectorAll('.eye');
                eyes.forEach(eye => eye.classList.add('blink'));
                setTimeout(() => {
                    eyes.forEach(eye => eye.classList.remove('blink'));
                }, 200);
            }
        }, 4000); // 4초마다 깜빡임
    }

    setRobotState(state) {
        this.widget.setAttribute('data-state', state);
        this.robotFace.classList.remove('bounce');
        void this.robotFace.offsetWidth;
        this.robotFace.classList.add('bounce');

        // happy(하트 눈) 상태인 경우 3초 뒤에 idle로 복귀
        if (this.stateTimerId) clearTimeout(this.stateTimerId);
        if (state === 'happy') {
            this.stateTimerId = setTimeout(() => {
                if (this.widget.getAttribute('data-state') === 'happy') {
                    this.setRobotState('idle');
                }
            }, 3000);
        }
    }

    setReadiness(isReady) {
        this.widget.setAttribute('data-ready', isReady ? 'ready' : 'not-ready');
    }

    // 볼륨에 따른 입과 안테나 반응
    handleVolumeEffect(rms, isListening) {
        if (!isListening) {
            this.mouthShape.style.transform = '';
            this.antennaBall.style.transform = '';
            return;
        }
        const normalized = Math.min(rms / 0.15, 1);
        this.mouthShape.style.transform = `scaleY(${0.5 + normalized * 0.8})`;
        this.antennaBall.style.transform = `scale(${1 + normalized * 0.5})`;
    }

    showBubble(text, durationMs) {
        if (this.typingTimerId) clearTimeout(this.typingTimerId);
        if (this.bubbleTimerId) clearTimeout(this.bubbleTimerId);

        this.speechBubble.innerHTML = '<span class="typing-cursor"></span>';
        this.speechBubble.style.display = 'block';
        this.speechBubble.scrollTop = 0;
        requestAnimationFrame(() => this.speechBubble.classList.add('visible'));

        let charIndex = 0;
        const chars = [...text];

        const typeNext = () => {
            if (charIndex < chars.length) {
                const cursor = this.speechBubble.querySelector('.typing-cursor');
                if (cursor) cursor.insertAdjacentText('beforebegin', chars[charIndex]);
                charIndex++;

                this.typingTimerId = setTimeout(typeNext, 35 + Math.random() * 25);
            } else {
                const cursor = this.speechBubble.querySelector('.typing-cursor');
                if (cursor) cursor.remove();
                this.bubbleTimerId = setTimeout(() => {
                    this.speechBubble.classList.remove('visible');
                    setTimeout(() => { this.speechBubble.style.display = 'none'; }, 400);
                }, durationMs);
            }
        };
        this.typingTimerId = setTimeout(typeNext, 200);
    }

    // 눈동자 위치 업데이트 (마우스 위치 기반)
    updateEyeGaze(mouseX, mouseY) {
        // 자거나, 에러 났거나, 행복할(하트 눈) 때는 눈을 굴리지 않음
        const state = this.widget.getAttribute('data-state');
        if (state === 'sleeping' || state === 'error' || state === 'happy' || state === 'thinking') {
            document.querySelectorAll('.pupil').forEach(p => p.style.transform = '');
            return;
        }

        document.querySelectorAll('.eye').forEach(eye => {
            const rect = eye.getBoundingClientRect();
            // 눈동자 정중앙 좌표
            const eyeCenterX = rect.left + rect.width / 2;
            const eyeCenterY = rect.top + rect.height / 2;

            // 마우스와 눈 사이의 각도와 거리 계산
            const deltaX = mouseX - eyeCenterX;
            const deltaY = mouseY - eyeCenterY;
            const angle = Math.atan2(deltaY, deltaX);

            // 눈동자가 흰자를 벗어나지 않게 최대 이동 거리를 3.5px로 제한
            const maxDistance = 3.5;
            const distance = Math.min(maxDistance, Math.hypot(deltaX, deltaY) / 30);

            const moveX = Math.cos(angle) * distance;
            const moveY = Math.sin(angle) * distance;

            const pupil = eye.querySelector('.pupil');
            if (pupil) {
                // 기존 css 애니메이션과 충돌하지 않게 transform 세팅
                pupil.style.transform = `translate(${moveX}px, ${moveY}px)`;
            }
        });
    }
}