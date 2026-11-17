"use client";

import styles from "@/modules/academy/styles/learning.module.scss";

export default function LearningPageEntrance({ transitionKey, children }) {
  return <div key={transitionKey} className={styles.pageEntrance}>{children}</div>;
}
