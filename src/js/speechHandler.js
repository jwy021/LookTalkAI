export class SpeechHandler {
    constructor(onResultCallback) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'ko-KR';
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.isRecording = false;

        this.recognition.onresult = (event) => {
            const text = event.results[event.results.length - 1][0].transcript;
            onResultCallback(text);
        };
    }

    start() {
        if (!this.isRecording) {
            this.isRecording = true;
            try { this.recognition.start(); } catch (e) { }
        }
    }

    stop() {
        if (this.isRecording) {
            this.isRecording = false;
            try { this.recognition.stop(); } catch (e) { }
        }
    }
}