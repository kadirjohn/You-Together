/// <reference types="vite/client" />
/// <reference types="youtube" />

// YouTube IFrame Player API global tipleri. @types/youtube `YT` namespace'ini
// sağlar; burada window üzerindeki erişimi augment ediyoruz (SDK script inject
// edildikten sonra window.YT ve window.onYouTubeIframeAPIReady kullanılır).
interface Window {
  YT: typeof YT;
  onYouTubeIframeAPIReady?: () => void;
}
