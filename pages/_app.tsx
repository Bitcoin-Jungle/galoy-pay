import "bootstrap/dist/css/bootstrap.min.css"
import "./index.css"

import Head from "next/head"
import dynamic from "next/dynamic"
import { NextPage } from "next"

import Header from "../components/header"

const GraphQLProvider = dynamic(() => import("../lib/graphql"), { ssr: false })

export default function Layout({
  Component,
  pageProps,
}: {
  Component: NextPage
  pageProps: Record<string, unknown>
}) {
  return (
    <>
      <Head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#000000" />
        <meta
          name="description"
          content="Bitcoin Jungle official lightning network node"
        />
        <title>BitcoinJungle Lightning Node</title>
      </Head>
      <GraphQLProvider>
        <Header />
        <Component {...pageProps} />
      </GraphQLProvider>
    </>
  )
}
