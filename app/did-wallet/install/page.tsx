import Link from "next/link";

export const metadata = { title: "증명서 지갑 설치 | VeraWallet" };

export default function InstallDidWallet() {
  return (
    <main className="space-y-6 px-5 py-8">
      <Link href="/settings" className="text-sm text-primary-600">설정으로 돌아가기</Link>
      <h1 className="text-2xl font-semibold">증명서 지갑 설치</h1>
      <p className="text-sm leading-6 text-zinc-600">VeraWallet 테스트용 DID CA 앱에 리포트 증명서를 보관합니다. Android 8 이상에서 사용할 수 있으며, iPhone용 설치 파일은 제공하지 않습니다.</p>
      <a href="/downloads/verawallet-did-ca.apk" className="block rounded-xl bg-primary-500 px-4 py-3 text-center font-medium text-white">Android 테스트 앱 내려받기</a>
      <p className="text-xs leading-5 text-zinc-500">스토어 배포 앱이 아닌 테스트 APK입니다. 기존 VeraWallet DID CA 사용자는 앱을 삭제하지 말고 업데이트하세요. 삭제하면 기기에 보관된 키와 증명서를 잃을 수 있습니다.</p>
      <ol className="list-decimal space-y-4 pl-5 text-sm leading-6">
        <li>Android 폰에서 설치 파일을 열고, 필요한 경우 해당 브라우저의 ‘이 출처 허용’을 켜서 설치합니다.</li>
        <li>DID CA 앱에서 사용자 등록과 PIN 설정을 완료합니다. Development account ID를 요청하면 테스트 운영자에게 발급받은 계정을 사용하세요. 모바일 신분증 번호나 지갑 주소를 입력하는 항목이 아닙니다.</li>
        <li>지갑 연결에 제출할 테스트 신분 증명서(VC)를 먼저 발급받으세요. 등록과 PIN 설정만으로 증명서가 생기지는 않습니다. 계정·초기 증명서 발급 안내는 테스트 운영자에게 요청하세요.</li>
        <li>VeraWallet에서 모바일 신분증으로 로그인한 뒤, 설정의 ‘증명서 지갑 연결’을 누릅니다. 다른 기기에 표시된 QR을 DID CA로 스캔하고 PIN으로 승인합니다.</li>
        <li>리포트를 CSV 또는 XLSX로 내려받아 근거 기록을 저장한 뒤 ‘VC로 받기’에서 발급 QR을 스캔합니다.</li>
      </ol>
      <p className="rounded-xl bg-white p-4 text-sm leading-6 text-zinc-600">이 페이지의 새 앱은 공개 HTTPS 연결을 사용합니다. QR은 노트북 등 다른 화면에 띄워 주세요. 같은 폰에서 웹의 QR을 앱으로 바로 넘기는 기능은 아직 제공하지 않습니다.</p>
    </main>
  );
}
