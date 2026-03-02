
function get_workspace_name() {
  local dir="$PWD"
  if [[ "$dir" == /workspaces/* ]]; then
    local name=$(echo "$dir" | cut -d'/' -f4)
    echo "${(U)name}"
  else
    echo "%m"
  fi
}

function workspace_color() {
  local name=$(get_workspace_name)
  case "$name" in
    SEC)     echo "%{$fg_bold[green]%}" ;;
    LIBS)    echo "%{$fg_bold[magenta]%}" ;;
    BUILDER) echo "%{$fg_bold[yellow]%}" ;;
    *)       echo "%{$fg_bold[white]%}" ;;
  esac
}

ZSH_THEME_GIT_PROMPT_PREFIX="("
ZSH_THEME_GIT_PROMPT_SUFFIX=")"
PROMPT='$(workspace_color)$(get_workspace_name) ➜ %{$fg_no_bold[cyan]%}%~ %{$fg_bold[red]%}$(git_prompt_info) %{$reset_color%}$ '
