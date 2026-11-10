import   axios from "axios" ;
import { createClient } from "@/lib/client"
import type { User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { BACKEND_URL } from "../../config";

const supabase = createClient();

export default  function Dashboard() {
    const navigate = useNavigate();

    const [user, setUser] = useState<User | null>(null);

    useEffect(() => {
        async function getinfo() {

            const { data, error } = await supabase.auth.getUser()
            if (data.user) {
                setUser(data.user);
            }
        }
        getinfo(); 
    }, [])


    useEffect(()=>{

        async function  getExistingConversations() {
            if(user){
                const {data : { session }}  = await supabase.auth.getSession();
                const jwt = session?.access_token ;
                 const response = await axios.get(`${BACKEND_URL}/conversations`,{
                    headers:{
                        Authorization: jwt
                    }
                })

                console.log(response.data);
            }
        }
        getExistingConversations();
    },[user])

    return <div>
        {!user && <button onClick={() => {
            navigate("/auth");
        }}> Sign in </button>}
            {user && <div>
            { user?.email }
            <button className="m-5" onClick={()=>{
            supabase.auth.signOut()
            setUser(null);    
                }}>Logout</button>


            </div>}
    </div>


}