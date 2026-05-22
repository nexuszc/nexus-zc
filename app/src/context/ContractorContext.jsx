import { createContext, useContext, useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const ContractorContext = createContext({ contractorClientId: null, contractor: null, loading: true })

export function ContractorProvider() {
  const [contractorClientId, setContractorClientId] = useState(null)
  const [contractor, setContractor] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setLoading(false)
        navigate('/roofing/login')
        return
      }

      try {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/contractor-auth`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ action: 'get_contractor' }),
          }
        )
        const json = await res.json()
        if (json.contractor) {
          setContractor(json.contractor)
          setContractorClientId(json.contractor.client_id)
        } else {
          navigate('/roofing/login')
        }
      } catch {
        navigate('/roofing/login')
      }
      setLoading(false)
    }

    load()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => load())
    return () => subscription.unsubscribe()
  }, [])

  return (
    <ContractorContext.Provider value={{ contractorClientId, contractor, loading }}>
      <Outlet />
    </ContractorContext.Provider>
  )
}

export function useContractor() {
  return useContext(ContractorContext)
}
