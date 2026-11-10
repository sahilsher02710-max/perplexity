import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/client";

const supabase = createClient();

export default function Auth(){
    
    async function login(provider:"github" | "google" ){
        const {data , error } = await supabase.auth.signInWithOAuth({
            provider : provider
        })
        if(error){
                alert("Error while signin in");
        }else{
            alert("Signed in")
        }
    }

    
    

    
    return <div>
        <Button onClick={()=>login("google")}>Login with google </Button> 
        <br />
        <br />
        <Button  onClick={()=>login("github")}>Login with github </Button>
    </div>
}