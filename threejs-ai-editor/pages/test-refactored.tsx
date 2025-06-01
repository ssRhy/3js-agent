import React from "react";
import { GetServerSideProps } from "next";
import ThreeCodeEditor from "../components/ThreeCodeEditor";

export default function TestRefactored() {
  return (
    <div>
      <h1>Three.js AI Editor - Refactored Version</h1>
      <ThreeCodeEditor />
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    props: {},
  };
};
