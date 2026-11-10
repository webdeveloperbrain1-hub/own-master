import { useLayoutEffect } from 'react';
import { installScrollMotion } from './scrollRevealController';

export default function ScrollMotion() {
  useLayoutEffect(() => {
    const root = document.getElementById('root');
    return root ? installScrollMotion(root) : undefined;
  }, []);
  return null;
}
