/**
 * 값 자리 표시자. 숫자를 0으로 채우지 않고 "아직 모른다"를 모양으로 말한다.
 * 불러오기 모달과 같은 sweep 애니메이션(globals.css의 import-sweep)을 재사용한다.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`relative inline-block overflow-hidden rounded-lg bg-zinc-100 align-middle ${className}`}>
      <span className="absolute inset-0 animate-import-sweep bg-gradient-to-r from-transparent via-white/70 to-transparent" />
    </span>
  );
}
