import { NextApiRequest, NextApiResponse } from "next"
import originalUrl from "original-url"
import {
  ApolloClient,
  ApolloLink,
  concat,
  gql,
  HttpLink,
  InMemoryCache,
} from "@apollo/client"

import { GRAPHQL_URI_INTERNAL } from "../../../../lib/config"

const ipForwardingMiddleware = new ApolloLink((operation, forward) => {
  operation.setContext(({ headers = {} }) => ({
    headers: {
      ...headers,
      "x-real-ip": operation.getContext()["x-real-ip"],
      "x-forwarded-for": operation.getContext()["x-forwarded-for"],
    },
  }))

  return forward(operation)
})

const client = new ApolloClient({
  link: concat(
    ipForwardingMiddleware,
    new HttpLink({
      uri: GRAPHQL_URI_INTERNAL,
      fetchOptions: {
        timeout: 30000, // 30 seconds timeout
      },
    }),
  ),
  cache: new InMemoryCache(),
  defaultOptions: {
    mutate: {
      errorPolicy: 'all',
    },
  },
})

const BOLT_CARD_WITHDRAW_REQUEST = gql`
  mutation BoltCardWithdrawRequest($input: BoltCardWithdrawRequestInput!) {
    boltCardWithdrawRequest(input: $input) {
      errors {
        message
      }
      tag
      callback
      k1
      minWithdrawable
      maxWithdrawable
      defaultDescription
    }
  }
`

const BOLT_CARD_WITHDRAW_CALLBACK = gql`
  mutation BoltCardWithdrawCallback($input: BoltCardWithdrawCallbackInput!) {
    boltCardWithdrawCallback(input: $input) {
      errors {
        message
      }
      status
    }
  }
`

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" })
  }

  try {
    const { id } = req.query // Path parameter
    const { p, c, pr } = req.query // Query parameters

    console.log(id)

    if (!id || Array.isArray(id)) {
      return res.status(400).json({
        status: "ERROR",
        reason: "Invalid card ID parameter"
      })
    }

    // Get the base URL from the request
    const url = originalUrl(req)
    const baseUrl = `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`
    
    // Determine if this is a withdraw request or callback based on parameters
    if (p && c && !pr) {
      // This is a withdraw request
      return handleWithdrawRequest(req, res, id, p, c, baseUrl)
    } else if (pr) {
      // This is a callback with a payment request
      return handleWithdrawCallback(req, res, pr)
    } else {
      return res.status(400).json({
        status: "ERROR",
        reason: "Invalid parameters for LNURL withdraw"
      })
    }
  } catch (error: unknown) {
    console.error("Unexpected error:", error)
    return res.status(500).json({ 
      status: "ERROR",
      reason: error instanceof Error ? error.message : String(error) 
    })
  }
}

async function handleWithdrawRequest(
  req: NextApiRequest, 
  res: NextApiResponse, 
  cardId: string, 
  p: string | string[], 
  c: string | string[],
  baseUrl: string
) {
  console.log("Processing withdraw request:", { cardId, p, c, baseUrl, graphqlUri: GRAPHQL_URI_INTERNAL })
  
  try {
    const { data, errors: gqlErrors } = await client.mutate({
      mutation: BOLT_CARD_WITHDRAW_REQUEST,
      variables: {
        input: {
          cardId,
          p,
          c,
          baseUrl
        },
      },
      context: {
        "x-real-ip": req.headers["x-real-ip"],
        "x-forwarded-for": req.headers["x-forwarded-for"],
      },
    })
    
    // Log GraphQL errors if any
    if (gqlErrors && gqlErrors.length) {
      console.error("GraphQL errors:", JSON.stringify(gqlErrors, null, 2))
      return res.status(400).json({
        status: "ERROR",
        reason: `GraphQL errors: ${gqlErrors.map(e => e.message).join(", ")}`
      })
    }
    
    // Check for application-level errors
    if (data?.boltCardWithdrawRequest?.errors && data.boltCardWithdrawRequest.errors.length) {
      console.error("Application errors:", JSON.stringify(data.boltCardWithdrawRequest.errors, null, 2))
      return res.status(400).json({
        status: "ERROR",
        reason: `Failed to process withdraw request: ${data.boltCardWithdrawRequest.errors[0].message}`
      })
    }
    
    // If we got here, we should have valid data
    if (!data || !data.boltCardWithdrawRequest) {
      console.error("No data returned from GraphQL mutation")
      return res.status(500).json({
        status: "ERROR",
        reason: "No data returned from server"
      })
    }
    
    console.log("Bolt card withdraw request response:", data.boltCardWithdrawRequest)
    
    // Return LNURL withdraw response format
    return res.status(200).json({
      tag: data.boltCardWithdrawRequest.tag,
      callback: data.boltCardWithdrawRequest.callback,
      k1: data.boltCardWithdrawRequest.k1,
      minWithdrawable: data.boltCardWithdrawRequest.minWithdrawable,
      maxWithdrawable: data.boltCardWithdrawRequest.maxWithdrawable,
      defaultDescription: data.boltCardWithdrawRequest.defaultDescription
    })
  } catch (gqlError: any) {
    console.error("Apollo client error:", gqlError)
    
    // Extract detailed error information if available
    let errorMessage = "GraphQL request failed"
    let errorDetails = null
    
    if (gqlError.networkError && gqlError.networkError.result && gqlError.networkError.result.errors) {
      errorDetails = gqlError.networkError.result.errors
      console.error("Detailed GraphQL errors:", JSON.stringify(errorDetails, null, 2))
      errorMessage = errorDetails.map((e: any) => e.message).join(", ")
    }
    
    return res.status(500).json({
      status: "ERROR",
      reason: errorMessage,
      details: errorDetails
    })
  }
}

async function handleWithdrawCallback(
  req: NextApiRequest, 
  res: NextApiResponse, 
  pr: string | string[]
) {
  // Extract k1 from query parameters
  const { k1 } = req.query
  
  if (!k1 || Array.isArray(k1)) {
    return res.status(400).json({
      status: "ERROR",
      reason: "Invalid k1 parameter"
    })
  }
  
  console.log("Processing withdraw callback:", { k1, pr })
  
  try {
    const { data, errors: gqlErrors } = await client.mutate({
      mutation: BOLT_CARD_WITHDRAW_CALLBACK,
      variables: {
        input: {
          k1,
          pr: Array.isArray(pr) ? pr[0] : pr
        },
      },
      context: {
        "x-real-ip": req.headers["x-real-ip"],
        "x-forwarded-for": req.headers["x-forwarded-for"],
      },
    })
    
    // Log GraphQL errors if any
    if (gqlErrors && gqlErrors.length) {
      console.error("GraphQL errors:", JSON.stringify(gqlErrors, null, 2))
      return res.status(400).json({
        status: "ERROR",
        reason: `GraphQL errors: ${gqlErrors.map(e => e.message).join(", ")}`
      })
    }
    
    // Check for application-level errors
    if (data?.boltCardWithdrawCallback?.errors && data.boltCardWithdrawCallback.errors.length) {
      console.error("Application errors:", JSON.stringify(data.boltCardWithdrawCallback.errors, null, 2))
      return res.status(400).json({
        status: "ERROR",
        reason: `Failed to process withdraw callback: ${data.boltCardWithdrawCallback.errors[0].message}`
      })
    }
    
    // If we got here, we should have valid data
    if (!data || !data.boltCardWithdrawCallback) {
      console.error("No data returned from GraphQL mutation")
      return res.status(500).json({
        status: "ERROR",
        reason: "No data returned from server"
      })
    }
    
    console.log("Bolt card withdraw callback response:", data.boltCardWithdrawCallback)
    
    // Return the status from the callback
    return res.status(200).json({
      status: data.boltCardWithdrawCallback.status
    })
  } catch (gqlError: any) {
    console.error("Apollo client error:", gqlError)
    
    // Extract detailed error information if available
    let errorMessage = "GraphQL request failed"
    let errorDetails = null
    
    if (gqlError.networkError && gqlError.networkError.result && gqlError.networkError.result.errors) {
      errorDetails = gqlError.networkError.result.errors
      console.error("Detailed GraphQL errors:", JSON.stringify(errorDetails, null, 2))
      errorMessage = errorDetails.map((e: any) => e.message).join(", ")
    }
    
    return res.status(500).json({
      status: "ERROR",
      reason: errorMessage,
      details: errorDetails
    })
  }
} 