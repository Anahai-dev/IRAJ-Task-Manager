import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSearchParams, Link, Navigate } from 'react-router';
import { FolderKanban, FileText, Plus, ChevronLeft, Save, Trash2, Edit3, X, Download, Printer } from 'lucide-react';
import { Project, Document } from '../types';
import { safeFormatDate } from '../lib/utils';
import SafeMarkdown from '../components/SafeMarkdown';
import MDEditor from '@uiw/react-md-editor';
import { EmptyState } from '../components/EmptyState';
import { apiDelete, apiGet, apiPost, apiPut, fetchAllPages } from '../lib/api';

export default function Documents() {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  const documentId = searchParams.get('documentId');
  
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  // Editor states
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    fetchProjects();
  }, [token]);

  useEffect(() => {
    if (projectId) {
      fetchDocuments();
    }
  }, [projectId, token]);

  const fetchProjects = async () => {
    try {
      const data = await fetchAllPages<Project>('/api/projects');
      setAllProjects(data);
      if (projectId) {
        setProject(data.find((p: Project) => p.id === projectId) || null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (!projectId) setLoading(false);
    }
  };

  const fetchDocuments = async () => {
    try {
      const data = await apiGet<Document[]>(`/api/projects/${projectId}/documents`);
      setDocuments(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const selectedDocument = documents.find(d => d.id === documentId);

  useEffect(() => {
    if (selectedDocument && isEditing) {
       // if we are editing and select a new document, maybe reset or not, handled by startEdit
    }
  }, [selectedDocument]);

  const startEdit = (doc?: Document) => {
    if (doc) {
      setEditTitle(doc.title);
      setEditContent(doc.content);
    } else {
      setEditTitle('Untitled Document');
      setEditContent('');
    }
    setIsEditing(true);
  };

  const handleDownloadMarkdown = () => {
    if (!selectedDocument) return;
    const blob = new Blob([selectedDocument.content], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${selectedDocument.title.toLowerCase().replace(/\s+/g, '_')}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleSave = async () => {
    try {
      const payload = { title: editTitle, content: editContent };
      const savedDoc = documentId && documentId !== 'new'
        ? await apiPut<Document>(`/api/documents/${documentId}`, payload)
        : await apiPost<Document>(`/api/projects/${projectId}/documents`, payload);

      await fetchDocuments();
      setIsEditing(false);
      if (!documentId || documentId === 'new') {
        setSearchParams({ projectId: projectId || '', documentId: savedDoc.id });
      }
    } catch (err) {
      console.error("Failed to save document", err);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await apiDelete(`/api/documents/${id}`);
      if (documentId === id) {
        setSearchParams({ projectId: projectId || '' });
      }
      fetchDocuments();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) return <div className="p-8 text-primary">Loading documents...</div>;

  if (!projectId) {
    if (allProjects.length === 1) {
      return <Navigate to={`/documents?projectId=${allProjects[0].id}`} replace />;
    }
    
    return (
      <div className="flex-1 flex flex-col p-8 bg-page-bg overflow-y-auto">
        <h1 className="text-xl font-semibold text-strong tracking-tight opacity-90 mb-2">Select a Project</h1>
        <p className="text-sm text-subtle mb-8">Choose a project to view its documents</p>
        
        {allProjects.length === 0 ? (
          <div className="text-center p-12 bg-surface border border-border-subtle rounded-lg">
            <h2 className="text-lg font-medium text-strong mb-2">No projects found</h2>
            <p className="text-sm text-subtle mb-4">You need to create a project first before managing documents.</p>
            <Link to="/projects" className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-500 text-strong text-sm font-medium rounded transition-colors">
              Go to Projects
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {allProjects.map(p => (
              <Link 
                key={p.id} 
                to={`/documents?projectId=${p.id}`}
                className="block p-6 bg-surface border border-border-subtle hover:border-blue-500/50 rounded-lg transition-all hover:shadow-lg group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="p-2 bg-blue-500/10 text-blue-500 rounded group-hover:scale-110 transition-transform">
                    <FolderKanban size={24} />
                  </div>
                  <span className="text-xs font-mono text-muted bg-surface-accent px-2 py-1 rounded">
                    {p.projectKey || 'PRJ'}
                  </span>
                </div>
                <h3 className="text-lg font-medium text-strong mb-2 group-hover:text-blue-400 transition-colors">{p.name}</h3>
                <p className="text-sm text-subtle line-clamp-2">
                  {p.description ? p.description : 'No description'}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar for Document List */}
      <div className="w-64 flex-shrink-0 border-r border-border-subtle bg-surface-dim flex flex-col h-full overflow-hidden">
        <div className="p-4 border-b border-border-subtle">
          <Link to={`/documents`} className="text-xs font-medium text-subtle hover:text-strong flex items-center mb-4 transition-colors">
            <ChevronLeft size={14} className="mr-1" />
            Back to Projects
          </Link>
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-semibold text-strong truncate pr-2">{project?.name} Docs</h2>
            <Link 
              to={`/documents?projectId=${projectId}&documentId=new`}
              onClick={() => startEdit()}
              className="bg-blue-600 text-white hover:bg-blue-500 p-1.5 rounded shadow hover:scale-105 transition-all"
              title="New Document"
            >
              <Plus size={16} />
            </Link>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {documents.length === 0 ? (
            <p className="text-xs text-subtle italic p-2">No documents yet.</p>
          ) : (
            documents.map(doc => (
              <div key={doc.id} className="group flex items-center justify-between">
                <Link
                  to={`/documents?projectId=${projectId}&documentId=${doc.id}`}
                  onClick={() => setIsEditing(false)}
                  className={`flex-1 flex items-center space-x-2 px-3 py-2 rounded-md text-sm transition-colors ${
                    documentId === doc.id 
                      ? 'bg-blue-500/10 text-blue-400 font-medium' 
                      : 'text-subtle hover:bg-surface hover:text-strong'
                  }`}
                >
                  <FileText size={14} className={documentId === doc.id ? 'text-blue-500' : 'text-muted'} />
                  <span className="truncate">{doc.title}</span>
                </Link>
                <button 
                  onClick={(e) => handleDelete(doc.id, e)}
                  className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 p-1.5 hover:bg-red-400/10 rounded mr-1 transition-all"
                  title="Delete Document"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-page-bg">
        {documentId === 'new' ? (
          // New Document Editor
          <div className="flex-1 flex flex-col p-6 overflow-hidden">
            <div className="flex justify-between items-center mb-6">
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                className="text-2xl font-semibold bg-surface border border-border-subtle focus:border-blue-500 rounded px-3 py-2 outline-none text-strong placeholder-muted flex-1"
                placeholder="Document Title"
              />
              <div className="flex items-center space-x-2 ml-4">
                <Link to={`/documents?projectId=${projectId}`} className="text-subtle hover:text-strong px-3 py-1.5 rounded-md text-sm transition-colors">
                  Cancel
                </Link>
                <button 
                  onClick={handleSave}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-md text-sm font-medium flex items-center space-x-2 transition-colors disabled:opacity-50"
                  disabled={!editTitle.trim()}
                >
                  <Save size={16} />
                  <span>Save</span>
                </button>
              </div>
            </div>
            <div data-color-mode="dark" className="flex-1 flex flex-col min-h-0 bg-surface-dim border border-border-subtle rounded-lg overflow-hidden">
              <MDEditor
                value={editContent}
                onChange={(val) => setEditContent(val || '')}
                height="100%"
                className="flex-1 w-full overflow-hidden"
                previewOptions={{
                  skipHtml: true
                }}
              />
            </div>
          </div>
        ) : selectedDocument ? (
          // View or Edit Selected Document
          <div className="flex-1 flex flex-col p-8 overflow-y-auto">
            {isEditing ? (
              <div className="flex-1 flex flex-col h-full max-w-4xl mx-auto w-full">
                <div className="flex justify-between items-center mb-6">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    className="text-2xl font-semibold bg-surface border border-border-subtle focus:border-blue-500 rounded px-3 py-2 outline-none text-strong placeholder-muted flex-1"
                    placeholder="Document Title"
                  />
                  <div className="flex items-center space-x-2 ml-4 shrink-0">
                    <button onClick={() => setIsEditing(false)} className="text-subtle hover:text-strong px-3 py-1.5 rounded-md text-sm transition-colors border border-border-subtle hover:bg-surface">
                      Cancel
                    </button>
                    <button 
                      onClick={handleSave}
                      className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-md text-sm font-medium flex items-center space-x-2 transition-colors"
                    >
                      <Save size={16} />
                      <span>Update</span>
                    </button>
                  </div>
                </div>
                <div data-color-mode="dark" className="flex-1 flex flex-col min-h-0 w-full min-h-[500px] border border-border-subtle rounded-lg overflow-hidden">
                  <MDEditor
                    value={editContent}
                    onChange={(val) => setEditContent(val || '')}
                    height="100%"
                    className="flex-1 w-full"
                    previewOptions={{
                      skipHtml: true
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto w-full">
                <div className="flex justify-between items-start mb-8 pb-4 border-b border-border-subtle">
                  <div>
                    <h1 className="text-3xl font-bold text-strong mb-2">{selectedDocument.title}</h1>
                    <p className="text-xs text-muted flex items-center space-x-2">
                      <span>Last updated: {safeFormatDate(selectedDocument.updatedAt, 'PP')}</span>
                    </p>
                  </div>
                  <div className="flex items-center space-x-2 shrink-0">
                    <button 
                      onClick={handleDownloadMarkdown}
                      className="flex items-center space-x-1.5 text-muted hover:text-strong bg-surface border border-border-subtle hover:bg-surface-accent px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                      title="Download raw Markdown (.md)"
                    >
                      <Download size={14} />
                      <span className="hidden sm:inline">Export MD</span>
                    </button>
                    <button 
                      onClick={handlePrint}
                      className="flex items-center space-x-1.5 text-muted hover:text-strong bg-surface border border-border-subtle hover:bg-surface-accent px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                      title="Print or Save as PDF"
                    >
                      <Printer size={14} />
                      <span className="hidden sm:inline">Print / PDF</span>
                    </button>
                    <button 
                      onClick={() => startEdit(selectedDocument)}
                      className="flex items-center space-x-1.5 text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                    >
                      <Edit3 size={14} />
                      <span>Edit</span>
                    </button>
                  </div>
                </div>
                
                <div className="prose dark:prose-invert prose-blue max-w-none text-sm text-subtle leading-relaxed">
                  <SafeMarkdown>{selectedDocument.content}</SafeMarkdown>
                </div>
              </div>
            )}
          </div>
        ) : (
          // Empty State
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={FileText}
              title="Select or create a document"
              description="Capture PRDs, architecture notes, and meeting summaries."
              actionText="New Document"
              onAction={() => {
                startEdit();
                setSearchParams({ projectId: projectId || '', documentId: 'new' });
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
