import { useEffect, useState } from "react";

/**
 * `flag` ancak `delay` ms boyunca açık kalırsa true döner; kapanınca hemen false olur.
 * Hızlı yüklenen (ör. boş) listelerde iskeletin bir anlığına görünüp kaybolmasını önler.
 */
export function useDelayedFlag(flag: boolean, delay = 300): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!flag) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(t);
  }, [flag, delay]);
  return flag && shown;
}
